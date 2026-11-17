/**
 * Live walk: docs/formation/TESTING.md "A move the GM's client is drawing",
 * steps 7-14, on the GM seat. A zone holds the party by core's footprint
 * (`token.regions`), and the walk reads what that membership does where
 * the movement chain asks: the delve's throw card, the trap check and the
 * journey's own write while the GM's client is still drawing the move; a token
 * three cells wide held by the zone over its last cell; a zone drawn as a core
 * `grid` shape; nested encounter zones ranked by `region.area`, the outer one
 * with a hole; the trap sweep's distance to a rectangle and a circle zone; and
 * `regionsTouch` of two Regions. Step 15 is steps 30a and 31 of the "Make it a
 * place" recipe, on a city of its own: a marker is filed under the place of the
 * quarter it stands in (moved into a second quarter, off every quarter, onto a
 * quarter with no place, left where it fell, and a place token moved after the
 * filing), and the hop's start quarter is the party's by core's footprint, read
 * with a party token three cells wide whose centre lies in one quarter and
 * whose first cell in the other. Load errors are read from a recorder added
 * before reload.
 *
 * Every fixture and figure is invented. Kept fixtures, found again by marker
 * (`api.fixture`): the scene `regions/scene-c`, the party `regions/party`, its
 * member `regions/walker`, `regions/wide` (the actor behind the wide token) and
 * the trap `regions/trap`; for step 15 the scene `regions/city`, its three
 * district Regions `regions/city-a`, `-b` (abutting, each linked to its own
 * place through the Region's flag) and `-c` (no place), the places
 * `regions/city-place` (the scene's own), `regions/city-place-a` and `-b`, and
 * the party `regions/city-party` with its member `regions/city-walker`. The
 * walk brings them to
 * its start shape itself: the party token at (500, 500) with the member joined,
 * the delve mode, the scene's cell sized so a 500 px step completes a turn; the
 * city party one cell wide at (400, 200) in the fixed shape, the Regions' shapes
 * and links as stated.
 * Zones, the wide token, the markers, the places the markers become, their tokens
 * and the cards the run's own moves post are made by the run, tracked by id the
 * moment their action resolves and swept by that list alone, a step's at its end.
 * Writes outside the ledger: the party's travel mode, put back to the delve; the
 * city party's token size and shape, put back to one cell and the world's
 * default; the marker lifetime, raised to six turns only while the world holds
 * it at 0 and put back.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { origin } = MACHINE;
const SCOPE = "acks-extras";
const ENC = `${SCOPE}.encounterZone`;
const TRAP = `${SCOPE}.trapZone`;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__rgBoot = { phase: "load", phases: [], errors: [] });
  const push = (kind, text) => R.errors.push({ phase: R.phase, kind, text: String(text).slice(0, 300) });
  const error = console.error.bind(console);
  console.error = (...args) => { push("console", args.map((a) => a?.message ?? a).join(" ")); error(...args); };
  addEventListener("error", (e) => push("error", e.message));
  addEventListener("unhandledrejection", (e) => push("rejection", e.reason?.message ?? e.reason));
  const arm = setInterval(() => {
    if (!globalThis.Hooks?.once) return;
    clearInterval(arm);
    for (const phase of ["init", "setup", "ready"]) Hooks.once(phase, () => { R.phase = phase; R.phases.push(phase); });
  }, 2);
})()`;

/* Page side: each function is stringified and run in the seat's page. */
const P = {
  census: async () => ({ role: game.user.role, isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, boot: globalThis.__rgBoot ?? null }),

  install: async () => {
    const H = (globalThis.__rg = globalThis.__rg ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.zones = await import(`${base}formation/zones.mjs`);
    H.enc = await import(`${base}formation/encounter-zone.mjs`);
    H.trap = await import(`${base}formation/trap-zone.mjs`);
    H.poi = await import(`${base}formation/poi.mjs`);
    H.engine = await import(`${base}formation/turn-engine.mjs`);
    H.regions = await import(`${base}lib/regions.mjs`);
    H.find = await import(`${base}formation/district-find.mjs`);
    H.sync = await import(`${base}formation/scene-sync.mjs`);
    H.strip = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    H.centre = (token) => {
      const s = token._source;
      const gs = token.parent.grid.size;
      return { x: s.x + (token.width * gs) / 2, y: s.y + (token.height * gs) / 2 };
    };
    if (!H.watch) {
      H.watch = true;
      H.arm = null;
      // Per record, what the token looked like at the instant the chain read it.
      const snap = () => {
        const a = H.arm;
        const token = a && fromUuidSync(a.tokenUuid);
        const region = a?.regionUuid ? fromUuidSync(a.regionUuid) : null;
        if (!token) return null;
        const gs = token.parent.grid.size;
        const prepared = { x: token.x + (token.width * gs) / 2, y: token.y + (token.height * gs) / 2 };
        const stored = H.centre(token);
        const at = (p) => (region ? !!region.testPoint({ x: p.x, y: p.y, elevation: token.elevation ?? 0 }) : null);
        return { drawn: token.x !== token._source.x || token.y !== token._source.y, held: region ? token.regions.has(region) : null, preparedIn: at(prepared), storedIn: at(stored) };
      };
      Hooks.on("updateToken", (doc, changes) => {
        if (H.arm && doc.uuid === H.arm.tokenUuid && ("x" in changes || "y" in changes)) H.arm.hook = snap();
      });
      Hooks.on("preCreateChatMessage", (msg) => {
        if (!H.arm) return;
        // The encounter throw's words ride in its flavor, a dice card's content being its rolls.
        H.arm.cards.push({ text: H.strip(`${msg.flavor ?? ""} ${msg.content ?? ""}`), ...snap() });
      });
      Hooks.on("updateSetting", (setting) => {
        if (!H.arm || setting.key !== "acks-extras.formations") return;
        const f = H.model.getFormation(H.arm.fid);
        H.arm.writes.push({ last: f?.clock?.lastPosition ?? null, zoneIds: f?.clock?.zoneIds ?? null, ...snap() });
      });
    }
    return { ok: typeof H.zones.zonesUnder === "function" && typeof H.regions.regionsUnder === "function" };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__rg;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** The party token at (500, 500) with the member joined, the delve mode, and a cell that makes a 500 px step a turn. */
  shape: async ({ fid, sceneId, actorId }) => {
    const H = globalThis.__rg;
    const scene = game.scenes.get(sceneId);
    if (!H.model.getFormation(fid).members.some((m) => m?.actorId === actorId)) {
      const doc = await game.actors.get(actorId).getTokenDocument({ x: 500, y: 500 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await H.model.addMember(H.model.getFormation(fid), game.actors.get(actorId), made);
    }
    await H.sleep(900);
    let f = H.model.getFormation(fid);
    const token = H.model.getPartyToken(f);
    if (!token) return { error: "no party token" };
    await acksExtras.formation.travel.setJourneyMode(fid, "delve");
    f = H.model.getFormation(fid);
    const distance = Math.ceil((H.engine.turnDistance(f, scene) * 1.2) / 5);
    await scene.update({ "grid.distance": distance, "grid.units": "ft" });
    if (token._source.x !== 500 || token._source.y !== 500) await token.update({ x: 500, y: 500 }, { animate: false });
    await H.sleep(1500);
    await acksExtras.formation.travel.setJourneyMode(fid, "delve");
    await H.sleep(500);
    return { tokenUuid: token.uuid, centre: H.centre(token), width: token.width, height: token.height, distance, gs: scene.grid.size, mode: H.model.getFormation(fid).travel?.mode };
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    let viewErr = null;
    // Not awaited: a view that never settles is read from the canvas below, in seconds, not as a 90 s page timeout.
    if (canvas.scene?.id !== sceneId) scene.view().catch((err) => { viewErr = String(err?.message ?? err); });
    const stop = Date.now() + 30000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    return { scene: canvas.scene?.id === sceneId && canvas.ready, viewErr, viewed: canvas.scene?.id ?? null, ready: canvas.ready };
  },

  /** Where the party token is, from its stored data. */
  where: async ({ fid }) => {
    const H = globalThis.__rg;
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    return { tokenUuid: token.uuid, centre: H.centre(token), width: token.width, height: token.height, gs: token.parent.grid.size };
  },

  /** Wait for a token's membership of a Region to read as asked, in this client's own `token.regions`. */
  awaitMember: async ({ tokenUuid, regionUuid, present }) => {
    const H = globalThis.__rg;
    const ok = await H.poll(() => {
      const token = fromUuidSync(tokenUuid);
      const region = fromUuidSync(regionUuid);
      return !!token && !!region && token.regions.has(region) === present;
    }, { tries: 60, every: 200 });
    return !!ok;
  },

  /** Move the party token as a drawn move, with the chain's reads recorded, and say what landed. */
  move: async ({ fid, tokenUuid, regionUuid, dx, dy, wait }) => {
    const H = globalThis.__rg;
    const token = fromUuidSync(tokenUuid);
    const dest = { x: token._source.x + dx, y: token._source.y + dy };
    const since = Date.now();
    H.arm = { fid, tokenUuid, regionUuid, dest, cards: [], writes: [], hook: null };
    const started = { drawnAtStart: false };
    // One space a second draws a 500 px step over five seconds, so the chain's reads (which take about a second to land) fall in its first half, before the token's prepared centre reaches a zone 250 px out.
    const speed0 = CONFIG.Token.movement.defaultSpeed;
    CONFIG.Token.movement.defaultSpeed = 1;
    let arm;
    try {
      const update = token.update(dest);
      started.drawnAtStart = token.x !== token._source.x || token.y !== token._source.y;
      await update;
      await H.sleep(wait ?? 8000);
    } finally {
      CONFIG.Token.movement.defaultSpeed = speed0;
      arm = H.arm;
      H.arm = null;
    }
    const ids = game.messages.contents.filter((m) => m.timestamp >= since).map((m) => ({ id: m.id, text: H.strip(`${m.flavor ?? ""} ${m.content ?? ""}`) }));
    return { dest, hook: arm.hook, cards: arm.cards, writes: arm.writes, ids, started };
  },

  /** Read the zone question four ways, for a token and the Region it is asked about. */
  tokenZones: async ({ tokenUuid, regionUuid, type }) => {
    const H = globalThis.__rg;
    const token = fromUuidSync(tokenUuid);
    const region = fromUuidSync(regionUuid);
    const centre = H.centre(token);
    return {
      held: token.regions.has(region),
      named: H.zones.zonesUnder(token, type).map((z) => z.region.uuid).includes(region.uuid),
      centreRead: H.regions.regionsAt(token.parent, centre, { elevation: token.elevation ?? 0 }, type).map((z) => z.region.uuid).includes(region.uuid),
      centre,
    };
  },

  found: async ({ fid, regionUuid, type }) => {
    const H = globalThis.__rg;
    const zone = H.zones.findZone(H.model.getFormation(fid), type);
    return { is: zone?.region.uuid === regionUuid, uuid: zone?.region.uuid ?? null };
  },

  journey: async ({ fid }) => {
    const H = globalThis.__rg;
    const zones = H.enc.journeyZones(H.model.getFormation(fid));
    return { layers: zones.layers.map((l) => ({ uuid: l.region.uuid, area: l.area })), target: zones.fields.encounterTarget };
  },

  near: async ({ fid }) => {
    const H = globalThis.__rg;
    const f = H.model.getFormation(fid);
    const token = H.model.getPartyToken(f);
    const scene = token.parent;
    return {
      half: (Math.max(token.width, token.height) * scene.grid.size) / 2,
      feetPerPixel: scene.grid.distance / scene.grid.size,
      rows: H.trap.placementsNear(f, { feet: Infinity }).map((p) => ({ region: p.region?.uuid ?? null, feet: p.distanceFeet })),
    };
  },

  touch: async ({ aUuid, bUuid, sceneId }) => {
    const H = globalThis.__rg;
    return !!H.poi.regionsTouch(fromUuidSync(aUuid), fromUuidSync(bUuid), game.scenes.get(sceneId));
  },

  setMode: async ({ fid, mode }) => {
    const H = globalThis.__rg;
    await acksExtras.formation.travel.setJourneyMode(fid, mode);
    await H.sleep(600);
    return H.model.getFormation(fid).travel?.mode;
  },

  lastIs: async ({ fid, tokenUuid }) => {
    const H = globalThis.__rg;
    const token = fromUuidSync(tokenUuid);
    const last = H.model.getFormation(fid).clock?.lastPosition;
    return !!last && last.x === token._source.x && last.y === token._source.y;
  },

  boot: async () => globalThis.__rgBoot ?? null,

  /** Step 15: the marker lifetime in turns, raised to six when the world has it at 0 (a drop returns null at 0). */
  markerTurns: async () => {
    const was = Number(game.settings.get("acks-extras", "transientIncidentTurns")) || 0;
    if (was <= 0) await game.settings.set("acks-extras", "transientIncidentTurns", 6);
    return { was, now: Number(game.settings.get("acks-extras", "transientIncidentTurns")) };
  },

  /** Step 15: a quarter's shape and link brought to the walk's start shape, the scene's own link beside them, and what each reads back. */
  cityPrep: async ({ sceneId, quarters, scenePlace }) => {
    const H = globalThis.__rg;
    const S = acksExtras.location.scenes;
    const scene = game.scenes.get(sceneId);
    const out = { quarters: [] };
    for (const q of quarters) {
      const region = fromUuidSync(q.uuid);
      const s = region.shapes[0];
      const r = q.rect;
      if (!s || s.type !== "rectangle" || s.x !== r.x || s.y !== r.y || s.width !== r.width || s.height !== r.height) {
        await region.update({ shapes: [{ type: "rectangle", x: r.x, y: r.y, width: r.width, height: r.height, rotation: 0, hole: false }] });
      }
      const place = q.place ? fromUuidSync(q.place) : null;
      if (place) {
        if (S.locationOfRegion(region)?.uuid !== place.uuid || S.regionOfLocation(place)?.uuid !== region.uuid) await S.linkRegion(region, place);
      } else if (S.locationOfRegion(region)) {
        await S.unlinkRegion(region);
      }
      out.quarters.push({
        uuid: q.uuid,
        place: S.locationOfRegion(region)?.uuid ?? null,
        mirror: place ? S.regionOfLocation(place)?.uuid ?? null : null,
        district: region.behaviors.some((b) => b.type === "acks-extras.district" && !b.disabled),
      });
    }
    const sp = fromUuidSync(scenePlace);
    if (S.locationOfScene(scene)?.uuid !== sp.uuid || S.sceneOfLocation(sp)?.uuid !== scene.uuid) await S.linkScene(scene, sp);
    out.scene = { place: S.locationOfScene(scene)?.uuid ?? null, mirror: S.sceneOfLocation(sp)?.uuid ?? null };
    out.order = scene.regions.contents.map((r) => r.uuid);
    return out;
  },

  /** Step 15: the city party's token, joined by its member, one cell in the shared-edge quarter's corner, in the `fixed` shape with its size stamped. */
  cityShape: async ({ fid, sceneId, actorId, corner }) => {
    const H = globalThis.__rg;
    const scene = game.scenes.get(sceneId);
    if (!H.model.getFormation(fid).members.some((m) => m?.actorId === actorId)) {
      const doc = await game.actors.get(actorId).getTokenDocument({ x: corner.x, y: corner.y });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await H.model.addMember(H.model.getFormation(fid), game.actors.get(actorId), made);
    }
    await H.sleep(900);
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    if (!token) return { error: "no party token" };
    if (token.parent.id !== sceneId) return { error: "the party token is on another scene" };
    await H.model.patchFormation(fid, (rec) => { rec.tokenShape = "fixed"; });
    await H.sleep(300);
    await H.sync.syncPartyTokenSize(H.model.getFormation(fid));
    const s = token._source;
    if (s.x !== corner.x || s.y !== corner.y || token.width !== 1 || token.height !== 1) {
      await token.update({ x: corner.x, y: corner.y, width: 1, height: 1 }, { animate: false, [H.poi.TRAVEL_OPTION]: true });
    }
    await H.sleep(800);
    return {
      tokenUuid: token.uuid, tokenId: token.id, x: token._source.x, y: token._source.y, width: token.width, height: token.height,
      shape: H.model.partyTokenShape(H.model.getFormation(fid)), stamp: token.getFlag("acks-extras", "partySize") ?? null,
      point: H.zones.partyPoint(H.model.getFormation(fid))?.point ?? null,
    };
  },

  /** Step 15: the district drawn over a point, as the promotion reads it. */
  districtAtPoint: async ({ sceneId, x, y }) => {
    const H = globalThis.__rg;
    return H.find.districtAt(game.scenes.get(sceneId), { x, y }, 0)?.region.uuid ?? null;
  },

  /** Step 15: drop an incident marker where the party stands, stamped with the district the party reads as in. */
  drop: async ({ fid, text }) => {
    const H = globalThis.__rg;
    const f = H.model.getFormation(fid);
    const here = H.find.findDistrict(f);
    const note = await H.poi.dropIncidentNote(f, { text, source: "city" }, { regionUuid: here?.region.uuid ?? null });
    if (!note) return { error: "no marker was made" };
    return { noteUuid: note.uuid, x: note.x, y: note.y, stamped: here?.region.uuid ?? null };
  },

  moveNote: async ({ noteUuid, x, y }) => {
    const note = fromUuidSync(noteUuid);
    await note.update({ x, y });
    return { x: note.x, y: note.y };
  },

  /**
   * Make a marker a place, and say what it made. Every Actor the call creates is
   * collected from `Actor.create`'s own results, so a throw after the create still
   * reports it; the place's token is read back by its actor's id.
   */
  promote: async ({ noteUuid, name }) => {
    const H = globalThis.__rg;
    const note = fromUuidSync(noteUuid);
    const scene = note.parent;
    const orig = Actor.create;
    const madeActors = [];
    Actor.create = async function (...args) {
      const doc = await orig.apply(this, args);
      if (doc?.uuid) madeActors.push(doc.uuid);
      return doc;
    };
    let actor = null;
    let error = null;
    try {
      actor = await H.poi.promoteIncident(note, { name });
    } catch (err) {
      error = String(err?.message ?? err);
    } finally {
      Actor.create = orig;
    }
    const tokens = actor ? scene.tokens.filter((t) => t.actorId === actor.id) : [];
    return {
      error, made: madeActors, actorUuid: actor?.uuid ?? null, parentUuid: actor?.system?.parentUuid ?? null,
      tokenUuids: tokens.map((t) => t.uuid), centre: tokens[0] ? H.centre(tokens[0]) : null,
      noteGone: !fromUuidSync(noteUuid),
    };
  },

  parentOf: async ({ actorUuid }) => fromUuidSync(actorUuid)?.system?.parentUuid ?? null,

  moveToken: async ({ tokenUuid, x, y }) => {
    const H = globalThis.__rg;
    const token = fromUuidSync(tokenUuid);
    await token.update({ x, y }, { animate: false });
    await H.sleep(1500);
    return { x: token._source.x, y: token._source.y };
  },

  /** Step 15: stand the party token at a corner and a width, as the module's own hop moves it (no movement chain). */
  stand: async ({ fid, x, y, width }) => {
    const H = globalThis.__rg;
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    await token.update({ x, y, width, height: 1 }, { animate: false, [H.poi.TRAVEL_OPTION]: true });
    await H.sleep(2000);
    const s = token._source;
    return { x: s.x, y: s.y, width: token.width, height: token.height, stamp: token.getFlag("acks-extras", "partySize") ?? null };
  },

  /** Step 15: what the wide party token reads as: core's footprint set, the module's pick, and the point read at its centre. */
  footprint: async ({ fid, typeDistrict }) => {
    const H = globalThis.__rg;
    const f = H.model.getFormation(fid);
    const token = H.model.getPartyToken(f);
    const centre = H.centre(token);
    return {
      centre,
      held: [...token.regions].map((r) => r.uuid),
      under: H.zones.zonesUnder(token, typeDistrict).map((z) => z.region.uuid),
      found: H.find.findDistrict(f)?.region.uuid ?? null,
      atCentre: H.find.districtAt(token.parent, centre, token.elevation ?? 0)?.region.uuid ?? null,
    };
  },

  /** Step 15: the hop, priced by the module (no turns spent), and what it said. */
  hop: async ({ fid, tokenId }) => {
    const H = globalThis.__rg;
    const r = await H.poi.travelToPlace(fid, tokenId, { spend: false });
    return { moved: !!r.moved, relation: r.relation ?? null, reason: r.reason ?? null };
  },

  /** Step 15: the city party back to one cell in its start corner and the world's default shape. */
  cityRestore: async ({ fid, corner }) => {
    const H = globalThis.__rg;
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    if (token) await token.update({ x: corner.x, y: corner.y, width: 1, height: 1 }, { animate: false, [H.poi.TRAVEL_OPTION]: true });
    await H.model.patchFormation(fid, (rec) => { rec.tokenShape = null; });
    return { width: token?.width ?? null, shape: H.model.partyTokenShape(H.model.getFormation(fid)) };
  },

  cardsSince: async ({ since }) => game.messages.contents.filter((m) => m.timestamp >= since).length,

  setMarkerTurns: async ({ value }) => {
    await game.settings.set("acks-extras", "transientIncidentTurns", value);
    return Number(game.settings.get("acks-extras", "transientIncidentTurns"));
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

const ready = async (api, label) => {
  for (let n = 0; n < 240; n++) {
    const ok = await api.eval(`!!(globalThis.game?.ready && globalThis.acksExtras?.formation)`).catch(() => false);
    if (ok) return n / 2;
    await sleep(500);
  }
  throw new Error(`${label} never reached ready`);
};

/** The recorder has to be in the page before the page loads, so it goes in over the seat's own CDP target. */
async function record(port, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 600000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, "gm");
  ws.close();
  return seconds;
}

const rectShape = (x, y, width, height, hole = false) => ({ type: "rectangle", x, y, width, height, rotation: 0, hole });
const zoneData = (name, shapes, type, system) => ({ name, color: "#336699", shapes, behaviors: [{ type, name, system }] });

let gm = null;
const temp = new Set();
const held = { fid: null, city: null, turnsWas: null };
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, gm));
  const census = await run(gm, P.census);
  check("the walk's seat is the active GM, so the automation runs on this client", census.isGM && census.activeGMIsSelf, census);
  if (!census.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  check("no error from load through ready", census.boot?.phases.length === 3 && !census.boot.errors.length, census.boot);
  note("installed", await run(gm, P.install));

  /** Make a world document the run owns; it is swept by id, never by name. */
  const made = async (kind, data, parent = null) => {
    const doc = await gm.create(kind, data, parent ? { parent } : {});
    temp.add(doc.uuid);
    return doc;
  };
  const drop = async (uuids) => {
    const only = [...uuids].filter((u) => temp.has(u));
    if (!only.length) return null;
    const out = await gm.sweepTracked({ only });
    for (const u of only) temp.delete(u);
    return out;
  };
  const trackCards = (ids, pattern) => {
    for (const c of ids.filter((m) => pattern.test(m.text))) temp.add(gm.track(c.id, "ChatMessage"));
  };

  section("fixtures");
  const scene = await gm.fixture("regions/scene-c", "Scene", { name: "QA Regions Ground", active: false, navigation: false, padding: 0, width: 3000, height: 3000, grid: { size: 100, distance: 5, units: "ft" } });
  const party = await gm.fixture("regions/party", "Actor", { name: "QA Regions Party", type: `${SCOPE}.party` });
  const walker = await gm.fixture("regions/walker", "Actor", { name: "QA Regions Walker", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
  const trapItem = await gm.fixture("regions/trap", "Item", { name: "QA Regions Trap", type: `${SCOPE}.trap`, system: { triggerOn: 0 } });
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  held.fid = fid;
  const shape = await run(gm, P.shape, { fid, sceneId: scene.id, actorId: walker.id });
  note("start shape", shape);
  if (shape.error) blocked(shape.error);
  check("the walk starts with the party token at (500, 500) on scene C, one cell or less, in the delve", shape.centre.x === 500 + (shape.width * shape.gs) / 2 && shape.width <= 1 && shape.height <= 1 && shape.mode === "delve", shape);
  check("the scene is viewed, so this client draws the token", (await run(gm, P.view, { sceneId: scene.id })).scene);
  const tokenUuid = shape.tokenUuid;
  const regionOf = (zone) => zone.uuid;

  section("7. an encounter zone east of the token, a drawn move");
  let where = await run(gm, P.where, { fid });
  let zone = await made("Region", zoneData("QA Regions Dungeon East", [rectShape(where.centre.x + 250, where.centre.y - 200, 400, 400)], ENC, { encounterEvery: 1, encounterTarget: 2 }), scene.uuid);
  let r = await run(gm, P.move, { fid, tokenUuid, regionUuid: regionOf(zone), dx: 500, dy: 0 });
  check("7: the GM's client is drawing the move when the movement hook runs", r.hook?.drawn === true, r.hook);
  let card = r.cards.find((c) => c.text.includes(`in zone "QA Regions Dungeon East"`));
  check("7: the turn's throw card names the zone", !!card, r.cards.map((c) => c.text.slice(0, 200)));
  check("7: when the card was created the token was still drawn, its prepared centre outside the zone, its stored centre inside, and token.regions held it", !!card && card.drawn && card.preparedIn === false && card.storedIn === true && card.held === true, card);
  trackCards(r.ids, /in zone "QA Regions Dungeon East"/);
  await drop([zone.uuid]);

  section("8. a trap zone south of the token, a drawn move");
  where = await run(gm, P.where, { fid });
  zone = await made("Region", zoneData("QA Regions Trap South", [rectShape(where.centre.x - 200, where.centre.y + 250, 400, 400)], TRAP, { trapUuid: trapItem.uuid, state: "armed" }), scene.uuid);
  r = await run(gm, P.move, { fid, tokenUuid, regionUuid: regionOf(zone), dx: 0, dy: 500 });
  check("8: the GM's client is drawing the move when the movement hook runs", r.hook?.drawn === true, r.hook);
  card = r.cards.find((c) => c.text.includes("The trap is not sprung"));
  check("8: the check's 'The trap is not sprung' card is made", !!card, r.cards.map((c) => c.text.slice(0, 200)));
  check("8: it was made while the token was drawn, its prepared centre outside the zone, and token.regions held the zone", !!card && card.drawn && card.preparedIn === false && card.held === true, card);
  trackCards(r.ids, /The trap is not sprung/);
  await drop([zone.uuid]);

  section("9. a journey entry zone east of the token, a drawn move");
  note("mode", await run(gm, P.setMode, { fid, mode: "journey" }));
  check("9: the mode write landed with clock.lastPosition at the token's stored corner", await run(gm, P.lastIs, { fid, tokenUuid }));
  where = await run(gm, P.where, { fid });
  zone = await made("Region", zoneData("QA Regions Journey East", [rectShape(where.centre.x + 250, where.centre.y - 200, 400, 400)], ENC, { journeyCadence: "entry", encounterTarget: 2 }), scene.uuid);
  r = await run(gm, P.move, { fid, tokenUuid, regionUuid: regionOf(zone), dx: 500, dy: 0 });
  check("9: the GM's client is drawing the move when the movement hook runs", r.hook?.drawn === true, r.hook);
  const write = r.writes.find((w) => w.last && w.last.x === r.dest.x && w.last.y === r.dest.y);
  check("9: the move's own record write names the entry zone in clock.zoneIds", !!write && (write.zoneIds ?? []).includes(zone.id), write);
  check("9: it landed while the token was drawn, its prepared centre outside the zone, and token.regions held it", !!write && write.drawn && write.preparedIn === false && write.held === true, write);
  trackCards(r.ids, /Navigation|in zone/i);
  note("mode back", await run(gm, P.setMode, { fid, mode: "delve" }));
  await drop([zone.uuid]);

  section("10. a token three cells wide is held by the zone over its last cell");
  const wideActor = await gm.fixture("regions/wide", "Actor", { name: "QA Regions Wide", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
  const wide = await made("Token", { name: "QA Regions Wide", actorId: wideActor.id, x: 2000, y: 2000, width: 3, height: 1, texture: { src: "icons/svg/mystery-man.svg" } }, scene.uuid);
  const last = await made("Region", zoneData("QA Regions Last Cell", [rectShape(2200, 2000, 100, 100)], ENC, { encounterTarget: 2 }), scene.uuid);
  const sliver = await made("Region", zoneData("QA Regions Sliver", [rectShape(2280, 2000, 20, 100)], ENC, { encounterTarget: 2 }), scene.uuid);
  check("10: core reports the token inside the last cell's zone", await run(gm, P.awaitMember, { tokenUuid: wide.uuid, regionUuid: last.uuid, present: true }));
  let z = await run(gm, P.tokenZones, { tokenUuid: wide.uuid, regionUuid: last.uuid, type: ENC });
  check("10: zonesUnder names it, and a read at the token's centre (2150, 2050) does not", z.held && z.named && !z.centreRead, z);
  z = await run(gm, P.tokenZones, { tokenUuid: wide.uuid, regionUuid: sliver.uuid, type: ENC });
  check("10: a 20 px sliver at the far edge, holding no cell's middle, is not held", !z.held && !z.named, z);
  await drop([wide.uuid, last.uuid, sliver.uuid]);

  section("11. a zone drawn as a core grid shape is found under the party");
  where = await run(gm, P.where, { fid });
  const cell = { i: Math.floor(where.centre.y / where.gs), j: Math.floor(where.centre.x / where.gs) };
  zone = await made("Region", { name: "QA Regions Grid", color: "#559933", shapes: [{ type: "grid", offsets: [cell, { i: cell.i, j: cell.j + 1 }], origin: null, hole: false }], behaviors: [{ type: ENC, name: "QA Regions Grid", system: { encounterTarget: 2 } }] }, scene.uuid);
  check("11: the party token's membership reads the grid zone", await run(gm, P.awaitMember, { tokenUuid, regionUuid: zone.uuid, present: true }));
  const grid = await run(gm, P.found, { fid, regionUuid: zone.uuid, type: ENC });
  check("11: findZone finds it", grid.is, grid);
  await drop([zone.uuid]);

  section("12. nested encounter zones, the outer with a hole: the smaller area wins a field");
  where = await run(gm, P.where, { fid });
  const ox = where.centre.x - 50;
  const oy = where.centre.y - 50;
  const outer = await made("Region", zoneData("QA Regions Outer", [rectShape(ox, oy, 1000, 1000), rectShape(ox + 100, oy + 100, 800, 800, true)], ENC, { encounterTarget: 2 }), scene.uuid);
  const inner = await made("Region", zoneData("QA Regions Inner", [rectShape(ox, oy, 700, 700)], ENC, { encounterTarget: 3 }), scene.uuid);
  check("12: the party stands in both", (await run(gm, P.awaitMember, { tokenUuid, regionUuid: outer.uuid, present: true })) && (await run(gm, P.awaitMember, { tokenUuid, regionUuid: inner.uuid, present: true })));
  const j = await run(gm, P.journey, { fid });
  const area = (uuid) => j.layers.find((l) => l.uuid === uuid)?.area;
  check("12: the outer's area is its ring, the hole taken out (360000 square pixels), the inner's 490000", Math.abs(area(outer.uuid) - 360000) < 500 && Math.abs(area(inner.uuid) - 490000) < 500, j.layers);
  check("12: the smaller area, the outer's, states the target: 2, not the inner's 3", j.target === 2, j.target);
  await drop([outer.uuid, inner.uuid]);

  section("13. the trap sweep's distance to a rectangle and a circle zone");
  where = await run(gm, P.where, { fid });
  const rectZone = await made("Region", zoneData("QA Regions Trap Rect", [rectShape(where.centre.x + 400, where.centre.y - 100, 200, 200)], TRAP, { trapUuid: trapItem.uuid, state: "armed" }), scene.uuid);
  const circleZone = await made("Region", zoneData("QA Regions Trap Circle", [{ type: "circle", x: where.centre.x - 700, y: where.centre.y, radius: 200, hole: false }], TRAP, { trapUuid: trapItem.uuid, state: "armed" }), scene.uuid);
  await sleep(1000);
  const near = await run(gm, P.near, { fid });
  const feet = (uuid) => near.rows.find((p) => p.region === uuid)?.feet;
  const want = (px) => Math.max(0, px - near.half) * near.feetPerPixel;
  const slack = 6 * near.feetPerPixel;
  note("near", { half: near.half, feetPerPixel: near.feetPerPixel, rect: feet(rectZone.uuid), circle: feet(circleZone.uuid) });
  check("13: the rectangle's distance is its nearest edge (400 px) less the token's half-size, in feet", Math.abs((feet(rectZone.uuid) ?? NaN) - want(400)) < 0.01, { got: feet(rectZone.uuid), want: want(400) });
  check("13: the circle's distance is the 500 px to its rim less the half-size, within six pixels' feet of its tessellation", Math.abs((feet(circleZone.uuid) ?? NaN) - want(500)) < slack, { got: feet(circleZone.uuid), want: want(500), slack });
  await drop([rectZone.uuid, circleZone.uuid]);

  section("14. two Regions touch only where they meet");
  const a = await made("Region", { name: "QA Regions Touch A", color: "#aa8833", shapes: [rectShape(100, 100, 200, 200)], behaviors: [] }, scene.uuid);
  const b = await made("Region", { name: "QA Regions Touch B", color: "#aa8833", shapes: [rectShape(300, 100, 200, 200)], behaviors: [] }, scene.uuid);
  const c = await made("Region", { name: "QA Regions Touch C", color: "#aa8833", shapes: [rectShape(900, 100, 200, 200)], behaviors: [] }, scene.uuid);
  check("14: two rectangles sharing an edge touch", await run(gm, P.touch, { aUuid: a.uuid, bUuid: b.uuid, sceneId: scene.id }) === true);
  check("14: two apart do not", await run(gm, P.touch, { aUuid: a.uuid, bUuid: c.uuid, sceneId: scene.id }) === false);
  await drop([a.uuid, b.uuid, c.uuid]);

  section("15. a marker is filed under the quarter it stands in, and the party's quarter is its footprint's");
  const LOC = `${SCOPE}.location`;
  const DISTRICT = `${SCOPE}.district`;
  const district = (name, rect) => ({ name, color: "#aa6633", shapes: [rectShape(rect.x, rect.y, rect.width, rect.height)], behaviors: [{ type: DISTRICT, name, system: {} }] });
  const RECT = { a: { x: 100, y: 100, width: 400, height: 400 }, b: { x: 500, y: 100, width: 400, height: 400 }, c: { x: 100, y: 600, width: 400, height: 400 } };
  const CORNER = { x: 400, y: 200 };
  const sweeps = [];
  const sweepOf = async (label, uuids) => {
    const out = await drop(uuids);
    if (out) { sweeps.push({ label, ...out }); note(`swept (${label})`, out); }
  };

  const city = await gm.fixture("regions/city", "Scene", { name: "QA Regions City", active: false, navigation: false, padding: 0, width: 3000, height: 3000, grid: { size: 100, distance: 5, units: "ft" } });
  const cityParty = await gm.fixture("regions/city-party", "Actor", { name: "QA Regions City Party", type: `${SCOPE}.party` });
  const cityWalker = await gm.fixture("regions/city-walker", "Actor", { name: "QA Regions City Walker", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
  const sceneItsPlace = await gm.fixture("regions/city-place", "Actor", { name: "QA Regions City Place", type: LOC });
  const placeA = await gm.fixture("regions/city-place-a", "Actor", { name: "QA Regions Quarter A Place", type: LOC });
  const placeB = await gm.fixture("regions/city-place-b", "Actor", { name: "QA Regions Quarter B Place", type: LOC });
  // Created in this order, so A precedes B in the scene's region order.
  const qA = await gm.fixture("regions/city-a", "Region", district("QA Regions Quarter A", RECT.a), { parent: city.uuid });
  const qB = await gm.fixture("regions/city-b", "Region", district("QA Regions Quarter B", RECT.b), { parent: city.uuid });
  const qC = await gm.fixture("regions/city-c", "Region", district("QA Regions Quarter C", RECT.c), { parent: city.uuid });

  const prep = await run(gm, P.cityPrep, {
    sceneId: city.id, scenePlace: sceneItsPlace.uuid,
    quarters: [{ uuid: qA.uuid, rect: RECT.a, place: placeA.uuid }, { uuid: qB.uuid, rect: RECT.b, place: placeB.uuid }, { uuid: qC.uuid, rect: RECT.c, place: null }],
  });
  const [pa, pb, pc] = prep.quarters;
  check("15 setup: A and B are each linked to their own place through the Region flag, the mirrors agree, and C has none", pa.place === placeA.uuid && pa.mirror === qA.uuid && pb.place === placeB.uuid && pb.mirror === qB.uuid && pc.place === null, prep);
  check("15 setup: the scene's own place is linked, all three Regions carry the district behaviour, and A precedes B in the scene's region order", prep.scene.place === sceneItsPlace.uuid && prep.scene.mirror === city.uuid && prep.quarters.every((q) => q.district) && prep.order.indexOf(qA.uuid) < prep.order.indexOf(qB.uuid), { scene: prep.scene, order: prep.order });
  { const seen = await run(gm, P.view, { sceneId: city.id }); check("15 setup: the city scene is viewed, so this client draws the tokens and computes core's membership", seen.scene, seen); }

  const cityFid = (await run(gm, P.formationOf, { partyId: cityParty.id })).fid;
  held.city = { fid: cityFid, corner: CORNER };
  const cityShape = await run(gm, P.cityShape, { fid: cityFid, sceneId: city.id, actorId: cityWalker.id, corner: CORNER });
  note("city party", cityShape);
  if (cityShape.error) blocked(cityShape.error);
  check("15 setup: the city party's token stands one cell wide at its corner in A, in the fixed shape", cityShape.x === CORNER.x && cityShape.y === CORNER.y && cityShape.width === 1 && cityShape.height === 1 && cityShape.shape === "fixed", cityShape);
  check("15 setup: the party's centre point lies in A and the quarterless C and the open ground read as such", (await run(gm, P.districtAtPoint, { sceneId: city.id, x: cityShape.point.x, y: cityShape.point.y })) === qA.uuid && (await run(gm, P.districtAtPoint, { sceneId: city.id, x: 300, y: 800 })) === qC.uuid && (await run(gm, P.districtAtPoint, { sceneId: city.id, x: 1500, y: 1500 })) === null, cityShape.point);
  const turns = await run(gm, P.markerTurns);
  held.turnsWas = turns.was;
  note("marker turns", turns);
  const since15 = Date.now();

  /** Drop a marker where the city party stands, optionally move it, then make it a place; every document is tracked by id as it appears. */
  const filedCase = async (label, to) => {
    const dropped = await run(gm, P.drop, { fid: cityFid, text: `QA Regions marker ${label}` });
    if (dropped.error) throw new Error(`15 (${label}): ${dropped.error}`);
    temp.add(gm.track(dropped.noteUuid, "Note"));
    let at = { x: dropped.x, y: dropped.y };
    if (to) at = await run(gm, P.moveNote, { noteUuid: dropped.noteUuid, ...to });
    const under = await run(gm, P.districtAtPoint, { sceneId: city.id, x: at.x, y: at.y });
    const made = await run(gm, P.promote, { noteUuid: dropped.noteUuid, name: `QA Regions place ${label}` });
    const placeUuids = [...new Set([...made.made, ...(made.actorUuid ? [made.actorUuid] : [])])];
    for (const u of placeUuids) temp.add(gm.track(u, "Actor"));
    for (const u of made.tokenUuids) temp.add(gm.track(u, "Token"));
    if (made.error) throw new Error(`15 (${label}): promoteIncident threw ${made.error}`);
    return { ...made, dropped, at, under, mine: [dropped.noteUuid, ...placeUuids, ...made.tokenUuids] };
  };

  const fa = await filedCase("a", { x: 700, y: 300 });
  check("15a: the marker was stamped A when it was dropped, then moved into B", fa.dropped.stamped === qA.uuid && fa.under === qB.uuid, { stamped: fa.dropped.stamped, under: fa.under });
  check("15a: the new place's parent is B's place, not A's", fa.parentUuid === placeB.uuid && fa.parentUuid !== placeA.uuid, { parent: fa.parentUuid, wantB: placeB.uuid, notA: placeA.uuid });
  check("15a: its token stands where the marker was left and the marker is gone", fa.tokenUuids.length === 1 && fa.centre?.x === 700 && fa.centre?.y === 300 && fa.noteGone, { centre: fa.centre, tokens: fa.tokenUuids.length, noteGone: fa.noteGone });

  const fb = await filedCase("b", { x: 1500, y: 1500 });
  check("15b: stamped A, the marker moved off every quarter", fb.dropped.stamped === qA.uuid && fb.under === null, { stamped: fb.dropped.stamped, under: fb.under });
  check("15b: the new place's parent is the scene's place", fb.parentUuid === sceneItsPlace.uuid, { parent: fb.parentUuid, want: sceneItsPlace.uuid });
  await sweepOf("15b", fb.mine);

  const fc = await filedCase("c", { x: 300, y: 800 });
  check("15c: stamped A, the marker moved onto the quarter that has no place", fc.dropped.stamped === qA.uuid && fc.under === qC.uuid, { stamped: fc.dropped.stamped, under: fc.under });
  check("15c: the new place's parent is the scene's place", fc.parentUuid === sceneItsPlace.uuid, { parent: fc.parentUuid, want: sceneItsPlace.uuid });
  await sweepOf("15c", fc.mine);

  const fd = await filedCase("d", null);
  check("15d: a marker left in A where the party dropped it", fd.dropped.stamped === qA.uuid && fd.under === qA.uuid, { stamped: fd.dropped.stamped, under: fd.under });
  check("15d: the new place's parent is A's place", fd.parentUuid === placeA.uuid, { parent: fd.parentUuid, want: placeA.uuid });
  await sweepOf("15d", fd.mine);

  // (e) reads the place (a) made: its token moved into A, the filing was read once.
  const moved = await run(gm, P.moveToken, { tokenUuid: fa.tokenUuids[0], x: 200, y: 200 });
  check("15e: core reads the place's token inside A after the move", await run(gm, P.awaitMember, { tokenUuid: fa.tokenUuids[0], regionUuid: qA.uuid, present: true }), moved);
  const parentAfter = await run(gm, P.parentOf, { actorUuid: fa.actorUuid });
  check("15e: its parent is still B's place", parentAfter === placeB.uuid, { parent: parentAfter, wantB: placeB.uuid });
  await sweepOf("15a/e", fa.mine);

  // (f) the hop's start quarter, by footprint.
  const targetA = await made("Token", { name: "QA Regions Target A", actorId: placeA.id, x: 100, y: 300, width: 1, height: 1, texture: { src: "icons/svg/house.svg" } }, city.uuid);
  const targetB = await made("Token", { name: "QA Regions Target B", actorId: placeB.id, x: 800, y: 300, width: 1, height: 1, texture: { src: "icons/svg/house.svg" } }, city.uuid);
  const idOf = (uuid) => uuid.split(".").pop();
  let stood = await run(gm, P.stand, { fid: cityFid, x: CORNER.x, y: CORNER.y, width: 3 });
  note("wide party", stood);
  const wideMade = stood.width === 3;
  check("15f: the party token can be made three cells wide in the fixed shape, and the module leaves it wide", wideMade && stood.height === 1 && stood.stamp?.width === 1, stood);
  if (wideMade) {
    const inA = await run(gm, P.awaitMember, { tokenUuid: cityShape.tokenUuid, regionUuid: qA.uuid, present: true });
    const inB = await run(gm, P.awaitMember, { tokenUuid: cityShape.tokenUuid, regionUuid: qB.uuid, present: true });
    const fp = await run(gm, P.footprint, { fid: cityFid, typeDistrict: DISTRICT });
    check("15f: core holds the wide party in A by its first cell and in B, its centre (550, 250) lying in B", inA && inB && fp.centre.x === 550 && fp.atCentre === qB.uuid && fp.held.includes(qA.uuid) && fp.held.includes(qB.uuid), fp);
    check("15f: the module's quarter for the party is A, the first of the footprint in region order, not the centre's B", fp.found === qA.uuid && fp.under[0] === qA.uuid, { found: fp.found, under: fp.under, order: prep.order });
    const hopA = await run(gm, P.hop, { fid: cityFid, tokenId: idOf(targetA.uuid) });
    check("15f: the hop to a place in A is priced `same`, so its `from` is A (a centre read would give `adjacent`)", hopA.relation === "same", hopA);
    stood = await run(gm, P.stand, { fid: cityFid, x: CORNER.x, y: CORNER.y, width: 3 });
    await run(gm, P.awaitMember, { tokenUuid: cityShape.tokenUuid, regionUuid: qA.uuid, present: true });
    const hopB = await run(gm, P.hop, { fid: cityFid, tokenId: idOf(targetB.uuid) });
    check("15f: the hop to a place in B is priced `adjacent`, so its `from` is A and not B (which would read `same`)", hopB.relation === "adjacent", hopB);
  } else {
    stood = await run(gm, P.stand, { fid: cityFid, x: CORNER.x, y: CORNER.y, width: 1 });
    const hopOne = await run(gm, P.hop, { fid: cityFid, tokenId: idOf(targetA.uuid) });
    check("15f (one cell, the wide token could not be made): a one-cell party standing in A prices `from` A", hopOne.relation === "same", hopOne);
  }
  await sweepOf("15f", [targetA.uuid, targetB.uuid]);
  note("15 chat messages dated since the step began (any author; read, never swept)", await run(gm, P.cardsSince, { since: since15 }));

  section("errors after ready");
  const boot = await run(gm, P.boot);
  check("nothing thrown over the walk", !boot?.errors.length, boot?.errors);
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (gm && held.city) note("city party put back", await run(gm, P.cityRestore, held.city)); } catch (err) { console.error("city:", err?.message ?? err); }
  try { if (gm && held.turnsWas != null && held.turnsWas <= 0) note("marker turns put back", await run(gm, P.setMarkerTurns, { value: held.turnsWas })); } catch (err) { console.error("turns:", err?.message ?? err); }
  try { if (gm && held.fid) note("travel mode put back", await run(gm, P.setMode, { fid: held.fid, mode: "delve" })); } catch (err) { console.error("mode:", err?.message ?? err); }
  try { if (gm && temp.size) note("swept (the run's own ids)", await gm.sweepTracked({ only: [...temp] })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  try { gm?.close(); } catch (_e) { /* closed */ }
}
