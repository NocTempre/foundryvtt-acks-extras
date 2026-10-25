/**
 * Live walk, formation-hex: docs/formation/TESTING.md "The hex the party is shown",
 * steps 1–11 on the GM seat (the active GM), the player's checks on the
 * player seat. Machine values arrive through ./_env.mjs; nothing here names a
 * port, a world or a seat. Every figure is invented; no imported table is ever
 * printed. FIXES=1 adds the fix block after step 1; ONLY_FIXES=1 runs that and
 * nothing after it.
 *
 * Writes outside the fixture ledger, each undone at teardown and reported:
 *   - an invented `travel` document registered at priority 30 (unregistered);
 *   - the world setting `travelEncounters`, set off for the walk (restored);
 *   - the driver GM seat's own client state: the dice rig and the patched
 *     notification methods (restored);
 *   - the world clock, which the journey and step 10 advance (reported as a
 *     delta, not restored — the march recipe's own convention).
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, shotDir } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const NONCE = "b" + Math.random().toString(36).slice(2, 8);
const MOD = "acks-extras";
const CELL = 100;
const MILES = 7; // invented cell width, equal to the invented cadence figure for X
const X = "outlands"; // cadence = one cell -> "grid"
const TARGET = 11; // invented navigation target: a natural 20 makes it, a natural 1 fails it

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameHex = (a, b) => !!a && !!b && a.i === b.i && a.j === b.j;
// Release snapshots (TOOLCHAIN §4b), taken in this same live session when SHOTS=1.
const SHOTS = process.env.SHOTS === "1";
const SHOT_DIR = shotDir();
const shot = async (seat, slug, selector) => {
  if (!SHOTS) return null;
  try {
    // Bring the subject into the viewport first: a clip is taken at the element's box, wherever that is.
    const seen = await seat.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el?.scrollIntoView({ block: "nearest" }); return !!el; })()`);
    await new Promise((r) => setTimeout(r, 400));
    const r = await seat.shot(`${SHOT_DIR}/${slug}.png`, selector); note(`shot ${slug}`, { seen, ...r }); return r;
  }
  catch (err) { note(`shot ${slug} FAILED`, err?.message ?? String(err)); return null; }
};

/* ------------------------------------------------------------------ */
/*  Page side (stringified and run in the seat's page)                  */
/* ------------------------------------------------------------------ */

const P = {
  census: async (mod) => ({
    foundry: game.version,
    module: game.modules.get(mod)?.version ?? null,
    role: game.user.role,
    userId: game.user.id,
    activeRoles: game.users.filter((u) => u.active).map((u) => u.role).sort(),
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    settings: {
      travelEncounters: game.settings.get(mod, "travelEncounters"),
      advanceWorldTime: game.settings.get(mod, "advanceWorldTime"),
    },
    worldTime: game.time.worldTime,
    messages: game.messages.size,
  }),

  /** Helpers every other page function reaches through `globalThis.__p2b`. */
  install: async () => {
    const H = (globalThis.__p2b = globalThis.__p2b ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 25, every = 100 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.F = acksExtras.formation;
    H.T = acksExtras.formation.travel;
    H.B = acksExtras.battlemap;
    const base = "/modules/acks-extras/scripts/";
    H.m = {
      paint: await import(base + "battlemap/terrain-paint.mjs"),
      tables: await import(base + "lib/tables.mjs"),
      model: await import(base + "formation/formation-model.mjs"),
      enc: await import(base + "formation/encounter-card.mjs"),
      encT: await import(base + "formation/encounter-terrains.mjs"),
      country: await import(base + "battlemap/country.mjs"),
      plate: await import(base + "formation/plate.mjs"),
      shadow: await import(base + "formation/shadow.mjs"),
      lost: await import(base + "formation/lost.mjs"),
      worldTime: await import(base + "lib/world-time.mjs"),
    };
    H.tableLabel = (key) => (H.m.encT.ENCOUNTER_TERRAINS[key] ? game.i18n.localize(H.m.encT.ENCOUNTER_TERRAINS[key].label) : null);
    H.formation = (id) => (typeof H.m.model.getFormation === "function" ? H.m.model.getFormation(id) : null) ?? H.F.getFormations()[id] ?? null;
    if (!H.notesPatched) {
      H.notes = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.notesPatched = true;
    }
    H.takeNotes = () => H.notes.splice(0);
    H.change = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    H.offsetOf = (token, scene) => {
      const c = H.T.tokenCentre(token, scene);
      const o = scene.grid.getOffset(c);
      return { i: o.i, j: o.j };
    };
    H.messagesSince = (t0) => game.messages.contents
      .filter((m) => (m.author?.id ?? m.user?.id) === game.user.id && m.timestamp >= t0 - 50)
      .map((m) => {
        const doc = new DOMParser().parseFromString(m.content ?? "", "text/html");
        const card = doc.querySelector(".acks-extras-nav-card");
        return {
          id: m.id, uuid: m.uuid, whisper: m.whisper ?? [], navCard: !!card,
          verdict: card?.querySelector(".acks-extras-nav-verdict")?.textContent.trim() ?? null,
          hints: card ? [...card.querySelectorAll("p.hint")].map((p) => p.textContent.trim()) : [],
          begin: !!card?.querySelector(".acks-extras-nav-begin"),
          realise: !!card?.querySelector(".acks-extras-nav-realise"),
          buttons: card ? card.querySelectorAll("button").length : 0,
          rows: card ? [...card.querySelectorAll("li")].map((li) => li.textContent.trim()) : [],
        };
      });
    H.rgb = (css) => {
      const s = String(css ?? "").trim();
      const m6 = /^#([0-9a-f]{6})$/i.exec(s);
      if (m6) return [parseInt(m6[1].slice(0, 2), 16), parseInt(m6[1].slice(2, 4), 16), parseInt(m6[1].slice(4, 6), 16)];
      const mr = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s);
      return mr ? [Number(mr[1]), Number(mr[2]), Number(mr[3])] : null;
    };
    H.near = (px, rgb, tol = 12) => !!rgb && Math.abs(px[0] - rgb[0]) <= tol && Math.abs(px[1] - rgb[1]) <= tol && Math.abs(px[2] - rgb[2]) <= tol && px[3] > 200;
    return { ok: true, version: game.modules.get("acks-extras")?.version ?? null };
  },

  viewScene: async (sceneId) => {
    const scene = game.scenes.get(sceneId);
    await scene.view();
    const t0 = performance.now();
    while (!(canvas.ready && canvas.scene?.id === sceneId) && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 1500));
    return { viewed: canvas.scene?.id === sceneId, ready: canvas.ready };
  },

  setSetting: async ({ mod, key, value }) => {
    const before = game.settings.get(mod, key);
    await game.settings.set(mod, key, value);
    return { before, after: game.settings.get(mod, key) };
  },

  /** Foundry's own parchment as the scene's background, through the scene's level. */
  setBackground: async ({ sceneId, src }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const served = (await fetch(foundry.utils.getRoute(src), { method: "HEAD" })).ok;
    const level = scene.levels?.contents?.[0] ?? null;
    if (level) await level.update({ "background.src": src });
    else await scene.update({ "background.src": src });
    await H.sleep(800);
    return { served, src: scene.background?.src ?? null, viaLevel: !!level, sceneRect: scene.dimensions?.sceneRect ?? null };
  },

  /** The six hexes: C two hexes inside the rectangle; A, B, D, E eastward along its row; T south-east of D. */
  layout: async ({ sceneId }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const grid = scene.grid;
    const rect = scene.dimensions.sceneRect;
    const first = grid.getOffset({ x: rect.x + grid.sizeX * 2.5, y: rect.y + grid.sizeY * 2.5 });
    const C = { i: first.i, j: first.j };
    const cells = { C };
    let prev = C;
    for (const k of ["A", "B", "D", "E"]) {
      const n = H.m.plate.neighbourToward(scene, prev, "e");
      cells[k] = n ? { i: n.i, j: n.j } : null;
      prev = cells[k] ?? prev;
    }
    const t = H.m.plate.neighbourToward(scene, cells.D, "se");
    cells.T = t ? { i: t.i, j: t.j } : null;
    const out = {};
    for (const [k, off] of Object.entries(cells)) {
      if (!off) { out[k] = null; continue; }
      const point = grid.getCenterPoint(off);
      const tl = grid.getTopLeftPoint(off);
      out[k] = { offset: off, point: { x: point.x, y: point.y }, xy: { x: tl.x, y: tl.y }, label: H.m.paint.hexLabelFromOffset(off), key: H.m.lost.hexKey(off) };
    }
    return { cells: out, orientation: H.m.plate.hexOrientation(scene), size: { sizeX: grid.sizeX, sizeY: grid.sizeY, type: grid.type, size: grid.size } };
  },

  /** The invented travel document, merged over whatever the world holds; nothing of it is returned. */
  registerTravel: async ({ X, miles, target, grounds }) => {
    const H = globalThis.__p2b;
    const cur = H.m.tables.getTable("travel", "encounterFrequency") ?? {};
    const freq = foundry.utils.mergeObject(cur, { traveling: { [X]: { kind: "perHex", mileHex: miles } } }, { inplace: false });
    const lost = foundry.utils.mergeObject(H.m.tables.getTable("travel", "gettingLost") ?? {}, Object.fromEntries(grounds.map((g) => [g, target])), { inplace: false });
    H.m.tables.registerTable({ id: "travel", tables: { encounterFrequency: freq, gettingLost: lost } }, { priority: 30, source: "p2b-walk" });
    return { cadX: H.m.enc.cadenceMilesFor(X), targets: grounds.map((g) => H.m.tables.getTable("travel", "gettingLost")?.[g] === target) };
  },

  unregisterTravel: async () => globalThis.__p2b.m.tables.unregisterTable("travel", { priority: 30 }),

  paintable: async () => {
    const H = globalThis.__p2b;
    const values = H.B.terrain.paintableValues("terrain");
    return { terrain: values, grounds: Object.fromEntries(values.map((v) => [v, H.m.encT.ENCOUNTER_TERRAINS[v]?.ground ?? null])) };
  },

  paintAt: async ({ sceneId, point, value, layer }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const ok = await H.B.terrain.paintHexAt(scene, point, value, layer);
    await H.sleep(300);
    return { ok, value: H.B.terrain.layerValueAt(scene, point, layer) };
  },

  regions: async ({ sceneId, layer }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const spec = H.B.terrain.PAINT_LAYERS[layer];
    return H.B.terrain.layerRegionsOf(scene, layer).map((r) => ({ id: r.id, uuid: r.uuid, value: r.getFlag("acks-extras", spec.flag) }));
  },

  sceneDefault: async ({ sceneId, country }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    await H.B.country.writeSceneSetup(scene, { country });
    await H.sleep(300);
    return H.B.country.sceneCountry(scene);
  },

  roadWall: async ({ sceneId, c, surface, from, to, off }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const [wall] = await scene.createEmbeddedDocuments("Wall", [{ c, ...H.B.roads.roadWallData({ surface }) }]);
    await H.sleep(300);
    return {
      id: wall.id, uuid: wall.uuid, road: wall.getFlag("acks-extras", "road") ?? null,
      on: H.B.roads.stepBetweenHexes(scene, from, to)?.on ?? null, offStep: H.B.roads.stepBetweenHexes(scene, to, off)?.on ?? null,
    };
  },

  waterLine: async ({ sceneId, c, kind, navigable }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const [wall] = await scene.createEmbeddedDocuments("Wall", [{ c, ...H.B.water.waterWallData({ kind, navigable }) }]);
    await H.sleep(300);
    return { id: wall.id, uuid: wall.uuid, water: wall.getFlag("acks-extras", "water") ?? null };
  },

  buildParty: async ({ partyId, sceneId, memberIds, xy, mode }) => {
    const H = globalThis.__p2b;
    const party = game.actors.get(partyId);
    const scene = game.scenes.get(sceneId);
    let formation = Object.values(H.F.getFormations()).find((f) => f.actorId === partyId) ?? null;
    if (!formation) return { error: "no formation for the party actor" };
    const td = await party.getTokenDocument({ x: xy.x, y: xy.y });
    const [token] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
    const adopted = await H.poll(() => H.F.getFormations()[formation.id]?.tokenId === token.id, { tries: 60, every: 200 });
    const app = await party.sheet.render(true);
    await H.sleep(1500);
    const el = H.root(app);
    const enrolled = [];
    for (const id of memberIds) {
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const ok = await H.poll(() => H.F.getFormations()[formation.id]?.members?.some((m) => m?.actorId === id), { tries: 40, every: 200 });
      enrolled.push(!!ok);
    }
    await H.T.setJourneyMode(formation.id, mode ?? "journey", { sceneId });
    await H.sleep(800);
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    formation = H.F.getFormations()[formation.id];
    return { formationId: formation.id, tokenUuid: token.uuid, tokenId: token.id, adopted: !!adopted, partyTokenOf: formation.tokenId, enrolled, mode: formation.travel?.mode ?? null, tokenImg: token.texture?.src ?? null };
  },

  /** Hex C stocked by hand: P found by this formation, Q by nobody. */
  writeStock: async ({ sceneId, offset, label, fid, X }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const key = H.F.hexStock.pure.hexStockKey({ offset });
    const point = (name, found) => ({ id: foundry.utils.randomID(), kind: "placed", name, sub: null, rarity: null, creature: null, draw: null, found, placeUuid: null, note: "" });
    const P = point("Point P", { [fid]: game.time.worldTime });
    const Q = point("Point Q", {});
    const record = { label, stocked: true, stockedAt: game.time.worldTime, terrain: "grassland", territory: X, count: 2, judgeCount: 2, substitute: false, points: [P, Q], searches: {}, assessments: {} };
    await H.F.hexStock.writeStock(scene, key, record);
    await H.sleep(400);
    const back = H.F.hexStock.readStock(scene, key);
    return { key, pId: P.id, qId: Q.id, stockedAt: record.stockedAt, back: back ? { points: back.points?.length, stocked: back.stocked } : null };
  },

  /** Rig the d20 so a throw lands on `want` (1 or 20), and read one roll back. */
  rig: async ({ want }) => {
    const H = globalThis.__p2b;
    if (!H.origUniform) H.origUniform = CONFIG.Dice.randomUniform;
    const read = async () => (await new Roll("1d20").evaluate()).total;
    for (const v of [0.975, 0.025]) {
      CONFIG.Dice.randomUniform = () => v;
      const got = await read();
      if (got === want) return { want, got, value: v };
    }
    return { want, got: await read(), value: null };
  },

  unrig: async () => {
    const H = globalThis.__p2b;
    if (H.origUniform) { CONFIG.Dice.randomUniform = H.origUniform; H.origUniform = null; return { restored: true, got: (await new Roll("1d20").evaluate()).total }; }
    return { restored: false };
  },

  calendar: async () => {
    const H = globalThis.__p2b;
    const d = game.time.calendar?.days ?? null;
    const secondsPerDay = d ? Number(d.hoursPerDay) * Number(d.minutesPerHour) * Number(d.secondsPerMinute) : null;
    return { calendarDay: H.m.worldTime.calendarDay(), secondsPerDay, worldTime: game.time.worldTime, hour: game.time.components?.hour ?? null };
  },

  advanceClock: async ({ seconds }) => {
    const H = globalThis.__p2b;
    const before = game.time.worldTime;
    await game.time.advance(seconds);
    await H.sleep(800);
    return { before, after: game.time.worldTime, calendarDay: H.m.worldTime.calendarDay() };
  },

  /** The record, raw and resolved, in the shape the recipe reads. */
  record: async ({ fid }) => {
    const H = globalThis.__p2b;
    const f = H.formation(fid);
    if (!f) return null;
    const t = H.T.travelOf(f);
    const tt = H.T.trueTravelOf(f);
    const l = t.lost;
    return {
      stored: { navigation: f.travel?.navigation ?? null, shown: f.travel?.shown ?? null, keys: Object.keys(f.travel ?? {}).sort() },
      navigation: t.navigation,
      owed: H.T.navigationOwed(f),
      dayKey: H.T.journeyDayKey(t),
      shown: t.shown,
      lost: { phase: l.phase, active: l.active, sceneId: l.sceneId, anchor: l.anchor, believed: l.believed, faked: l.faked, observations: l.observations },
      hex: t.hex ? { i: t.hex.i, j: t.hex.j, label: t.hex.label } : null,
      map: t.map ? { i: t.map.i, j: t.map.j, road: t.map.road, following: t.map.following, ground: t.map.ground } : null,
      ground: t.ground, road: t.road, following: t.following, encounterTerrain: t.encounterTerrain,
      trueGround: tt.ground, trueHex: tt.hex ? { i: tt.hex.i, j: tt.hex.j, label: tt.hex.label } : null, trueTable: tt.encounterTerrain,
      dayCount: t.dayCount, day: { miles: t.day?.miles ?? null, hours: t.day?.hours ?? null },
      tokenId: f.tokenId ?? null, sceneId: f.sceneId ?? null, worldTime: game.time.worldTime,
    };
  },

  /** Drag the party token to a top-left and report what the journey did. */
  drag: async ({ fid, xy }) => {
    const H = globalThis.__p2b;
    const f = H.formation(fid);
    const tok = H.F.getPartyToken(f);
    if (!tok) return { error: "no party token" };
    const t0 = Date.now();
    const before = { messages: game.messages.size, worldTime: game.time.worldTime };
    H.takeNotes();
    await tok.update({ x: xy.x, y: xy.y }, { animate: false });
    await H.poll(() => {
      const r = H.formation(fid);
      return r?.clock?.lastPosition?.x === xy.x && r?.clock?.lastPosition?.y === xy.y;
    }, { tries: 50, every: 100 });
    await H.sleep(2000);
    let offer = null;
    const later = document.querySelector('dialog button[data-action="later"], .dialog button[data-action="later"], .application.dialog button[data-action="later"]');
    if (later) { later.click(); offer = "answered later"; await H.sleep(400); }
    return { messages: H.messagesSince(t0), messagesDelta: game.messages.size - before.messages, worldTimeDelta: game.time.worldTime - before.worldTime, offer, notes: H.takeNotes() };
  },

  /** The formation's shadow on a scene, and how many it has anywhere. */
  shadow: async ({ sceneId, fid }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const s = H.m.shadow.shadowFor(scene, fid);
    const party = H.F.getPartyToken(H.formation(fid));
    return {
      shadow: s ? { id: s.id, uuid: s.uuid, hidden: s.hidden, offset: H.offsetOf(s, scene), x: s.x, y: s.y } : null,
      count: H.m.shadow.shadowsOf(fid).length,
      party: party ? { id: party.id, offset: party.parent?.id === sceneId ? H.offsetOf(party, scene) : null, x: party.x, y: party.y, sceneId: party.parent?.id ?? null } : null,
    };
  },

  /** Open the sheet fresh (or keep the open one) and describe what the recipe reads of it. */
  sheet: async ({ partyId, keep = false, render = true }) => {
    const H = globalThis.__p2b;
    const party = game.actors.get(partyId);
    const app = render ? await party.sheet.render(true) : party.sheet;
    await H.sleep(render ? 2000 : 300);
    const el = H.root(app);
    if (!el) return { rendered: false };
    const ctx = await app._prepareContext({});
    const tv = ctx.travel ?? {};
    const j = tv.judge ?? null;
    const plateDom = (kind) => {
      const canvasEl = el.querySelector(`canvas.acks-extras-plate__canvas[data-plate-kind="${kind}"]`);
      const box = canvasEl?.closest(".acks-extras-plate") ?? el.querySelector(`.acks-extras-plate--${kind}`);
      return {
        canvas: !!canvasEl, width: canvasEl?.width ?? null, height: canvasEl?.height ?? null,
        blank: !!box?.classList.contains("is-blank"), differ: !!box?.classList.contains("is-differ"),
        hex: box?.querySelector(".acks-extras-party-sheet__plate-hex")?.textContent.trim() ?? null,
        edit: !!box?.querySelector('[data-action="editPartyImage"]'), aria: canvasEl?.getAttribute("aria-label") ?? box?.querySelector("[aria-label]")?.getAttribute("aria-label") ?? null,
      };
    };
    const where = el.querySelector('[data-section="where"]');
    const nav = el.querySelector('[data-section="navigation"]');
    const shown = el.querySelector('[data-section="shown"]');
    const country = el.querySelector('[data-section="country"]');
    const pad = where ? [...where.querySelectorAll('[data-action="shiftTruth"]')].map((b) => b.dataset.direction) : [];
    const plate = tv.plate ? { draw: tv.plate.draw, blank: tv.plate.blank, center: tv.plate.center ?? null, tint: tv.plate.tint ?? null, points: (tv.plate.points ?? []).map((p) => ({ id: p.id, found: p.found })), sceneId: tv.plate.sceneId ?? null, judge: tv.plate.judge } : null;
    const out = {
      rendered: true,
      plate,
      frame: plateDom("frame"),
      framePlateCtx: ctx.frame?.plate ? { draw: ctx.frame.plate.draw, blank: ctx.frame.plate.blank, hex: ctx.frame.plate.hex, edit: ctx.frame.plate.edit } : null,
      reading: ctx.frame?.reading ? { overline: ctx.frame.reading.overline ?? null, chips: (ctx.frame.reading.chips ?? []).map((c) => ({ key: c.key, label: c.label, cls: c.cls ?? null })) } : null,
      chipsDom: [...el.querySelectorAll(".acks-extras-party-sheet__chip")].map((c) => ({ cls: c.className, text: c.textContent.trim() })),
      strip: { hex: ctx.strip?.hex ?? null, cadenceNext: ctx.strip?.cadence?.next ?? null },
      logHexes: (tv.log ?? []).map((e) => e.hex ?? null),
      hexField: el.querySelector('input[name="travel.hexLabel"]')?.value ?? null,
      shown: tv.shown ?? null, blank: tv.blank ?? null, shownUnknown: tv.shownUnknown ?? null,
      country: {
        unknownCtx: tv.country?.unknown ?? null, drawOn: tv.country?.encountersDrawOn ?? null,
        unknownDom: country?.querySelectorAll(".acks-extras-country-unknown").length ?? null,
        cardsDom: country?.querySelectorAll(".acks-extras-country-cards").length ?? null,
        cardCount: country?.querySelectorAll(".acks-extras-country-card").length ?? null,
        draw: country?.querySelector(".acks-extras-country-draw")?.textContent.trim() ?? null,
        overline: !!country?.querySelector(".acks-extras-shown-overline"),
      },
      hexStock: tv.hexStock ? { label: tv.hexStock.label, astray: tv.hexStock.astray, stockedAgo: tv.hexStock.stockedAgo, stockedLine: tv.hexStock.stockedLine, stockedDay: tv.hexStock.summary?.stockedDay ?? null, stocked: tv.hexStock.stocked } : null,
      stockDayDom: el.querySelector(".acks-extras-hex-stock-day")?.textContent.trim() ?? null,
      judge: j ? {
        where: { open: j.where.open, trueHex: j.where.trueHex, believedHex: j.where.believedHex, differ: j.where.differ, compass: j.where.compass, pad: j.where.pad ? j.where.pad.length : null },
        navigation: { state: j.navigation.state, line: j.navigation.line, canThrow: j.navigation.canThrow, history: j.navigation.history },
        shown: j.shown.map((s) => ({ value: s.value, checked: s.checked })),
        preview: { blank: j.preview.blank, hex: j.preview.hex, plateBlank: j.preview.plate?.blank, plateDraw: j.preview.plate?.draw, unknown: j.preview.country?.unknown ?? null, drawOn: j.preview.country?.encountersDrawOn ?? null },
      } : null,
      whereDom: where ? {
        truth: plateDom("true"), belief: plateDom("believed"),
        captionDiffer: !!where.querySelector(".acks-extras-where__caption.is-differ"),
        compass: where.querySelector(".acks-extras-where__compass")?.textContent.trim() ?? null,
        same: where.querySelector(".hint")?.textContent.trim() ?? null,
        pad,
      } : null,
      navDom: nav ? {
        state: nav.querySelector(".acks-extras-navigation__line")?.dataset.state ?? null,
        line: nav.querySelector(".acks-extras-navigation__line")?.textContent.trim() ?? null,
        throwNow: !!nav.querySelector('[data-action="navigationThrowNow"]'), throwNowDisabled: nav.querySelector('[data-action="navigationThrowNow"]')?.disabled ?? null,
        rows: [...nav.querySelectorAll(".acks-extras-navigation__row")].map((r) => ({
          strayed: r.classList.contains("is-strayed"),
          day: r.querySelector(".acks-extras-navigation__day")?.textContent.trim() ?? null,
          hex: r.querySelector(".acks-extras-navigation__hex")?.textContent.trim() ?? null,
          figures: r.querySelector(".acks-extras-navigation__figures")?.textContent.trim() ?? null,
          verdict: r.querySelector(".acks-extras-navigation__verdict")?.textContent.trim() ?? null,
          by: r.querySelector(".acks-extras-navigation__by")?.textContent.trim() ?? null,
        })),
      } : null,
      shownDom: shown ? {
        radios: [...shown.querySelectorAll('input[name="travel.shown"]')].map((i) => ({ value: i.value, checked: i.checked })),
        preview: !!shown.querySelector(".acks-extras-shown__preview"),
        previewPlate: plateDom("preview"),
        previewUnknown: shown.querySelectorAll(".acks-extras-shown__preview .acks-extras-country-unknown").length,
        previewCards: shown.querySelectorAll(".acks-extras-shown__preview .acks-extras-country-card").length,
        previewDraw: shown.querySelector(".acks-extras-shown__preview .acks-extras-country-draw")?.textContent.trim() ?? null,
      } : null,
      judgePart: !!el.querySelector('[data-application-part="judge"]'),
    };
    if (!keep) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    return out;
  },

  /** Read the pixels of a plate canvas on the OPEN sheet, after a re-render and a settle. */
  pixels: async ({ partyId, kind = "frame", pId = null, qId = null }) => {
    const H = globalThis.__p2b;
    const app = game.actors.get(partyId).sheet;
    await app.render();
    await H.sleep(1800);
    const el = H.root(app);
    const canvasEl = el?.querySelector(`canvas.acks-extras-plate__canvas[data-plate-kind="${kind}"]`);
    if (!canvasEl) return { canvas: false };
    const ctx = await app._prepareContext({});
    const spec = kind === "frame" ? ctx.frame?.plate : kind === "preview" ? ctx.travel?.judge?.preview?.plate : ctx.travel?.judge?.where?.[kind === "true" ? "truth" : "belief"];
    const scene = game.scenes.get(spec?.sceneId);
    const g = scene ? H.m.plate.plateGeometry(scene, spec.center, 404, { points: spec.points ?? [] }) : null;
    const c2 = canvasEl.getContext("2d");
    const px = (x, y) => [...c2.getImageData(Math.round(x), Math.round(y), 1, 1).data];
    const style = getComputedStyle(canvasEl);
    const gold = H.rgb(style.getPropertyValue("--acks-extras-plate-point"));
    let nonTransparent = 0;
    let opaque = 0;
    for (let y = 4; y < 404; y += 8) for (let x = 4; x < 404; x += 8) { const a = px(x, y)[3]; if (a > 0) { nonTransparent++; if (a === 255) opaque++; } }
    const pt = (id) => g?.points.find((p) => p.id === id) ?? null;
    const p = pId ? pt(pId) : null;
    const q = qId ? pt(qId) : null;
    const ring = [];
    if (q) for (let k = 0; k < 24; k++) { const a = (k / 24) * 2 * Math.PI; ring.push(px(q.x + Math.cos(a) * 404 * 0.028, q.y + Math.sin(a) * 404 * 0.028)); }
    const bare = document.createElement("canvas");
    let bareAlpha = null;
    if (g) {
      // The tint alone, read on a ring of radius 120 (outside the points' reach, inside the cell): the commonest alpha among twelve samples.
      H.m.plate.paintPlate(bare, g, { tint: spec.tint ?? null });
      const b2 = bare.getContext("2d");
      const tally = {};
      for (let k = 0; k < 12; k++) { const a = (k / 12) * 2 * Math.PI; const al = [...b2.getImageData(Math.round(202 + Math.cos(a) * 120), Math.round(202 + Math.sin(a) * 120), 1, 1).data][3]; tally[al] = (tally[al] ?? 0) + 1; }
      bareAlpha = Number(Object.entries(tally).sort((x, y) => y[1] - x[1])[0][0]);
    }
    return {
      canvas: true, width: canvasEl.width, height: canvasEl.height,
      geometry: g ? { kind: g.kind, vertices: g.polygon.length, roads: g.roads.map((r) => r.surface), water: g.water.map((w) => ({ kind: w.kind, navigable: w.navigable })), points: g.points.length } : null,
      tint: spec?.tint ?? null, corner: px(2, 2), nonTransparent, opaque, bareAlpha,
      gold, p: p ? { px: px(p.x, p.y), isGold: H.near(px(p.x, p.y), gold) } : null,
      q: q ? { ringGold: ring.filter((s) => H.near(s, gold)).length, ringSamples: ring.length } : null,
      pointsOnPlate: spec?.points?.map((x) => x.id) ?? [],
    };
  },

  /** The ground's colour as the brush paints it, for the tint check. */
  colorFor: async ({ value }) => globalThis.__p2b.m.paint.colorFor(value),

  /** Activate a primary tab on the OPEN sheet by its id, and front the chat log when asked. */
  tab: async ({ partyId, tab = null, chat = false, place = false, messageId = null }) => {
    const H = globalThis.__p2b;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    let found = null;
    if (place) app.setPosition({ left: 16, top: 16 });
    if (tab) {
      const n = el?.querySelector(`.tabs [data-group="primary"][data-tab="${tab}"]`);
      found = !!n;
      n?.click();
    }
    if (chat) { try { ui.sidebar?.expand?.(); ui.chat?.activate?.(); } catch (_e) { /* no sidebar */ } }
    await H.sleep(900);
    let li = null;
    if (messageId) { li = document.querySelector(`li.chat-message[data-message-id="${messageId}"]`); li?.scrollIntoView({ block: "end" }); await H.sleep(400); }
    return { found, active: app.tabGroups?.primary ?? null, li: messageId ? !!li : undefined, pos: place ? { left: app.position.left, top: app.position.top, width: app.position.width, height: app.position.height } : undefined, viewport: { w: window.innerWidth, h: window.innerHeight } };
  },

  /** Click a control on the OPEN sheet. */
  press: async ({ partyId, selector, settle = 1200 }) => {
    const H = globalThis.__p2b;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const n = el?.querySelector(selector);
    if (!n) return { found: false };
    H.takeNotes();
    const t0 = Date.now();
    n.click();
    await H.sleep(settle);
    return { found: true, notes: H.takeNotes(), messages: H.messagesSince(t0) };
  },

  /** Tick a radio on the OPEN sheet by name and value, letting the form submit. */
  /** Choose a select's value on the OPEN sheet as a user would, wait for the submit and the re-render, and read it back. */
  setSelect: async ({ partyId, name, value }) => {
    const H = globalThis.__p2b;
    const app = game.actors.get(partyId).sheet;
    const s = H.root(app)?.querySelector(`select[name="${name}"]`);
    if (!s) return { found: false };
    const options = [...s.options].map((o) => o.value);
    s.value = value;
    s.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(2000);
    const again = H.root(app)?.querySelector(`select[name="${name}"]`);
    return { found: true, options, set: s.value, after: again?.value ?? null, rerendered: again !== s };
  },

  /** The record's search answers for a formation. */
  campSaid: async ({ fid }) => {
    const H = globalThis.__p2b;
    const t = H.T.travelOf(H.formation(fid));
    return { present: t.camp.present, target: t.camp.target };
  },

  /** Press Roll weather on the OPEN sheet, read what the sky cache gained and what the party took, then put the cache back as it was. */
  /** A climate the imported weather document prices in winter and spring, for the generator; null when none. */
  pickClimate: async ({ want = "Cfb" } = {}) => {
    const H = globalThis.__p2b;
    const W = await import("/modules/acks-extras/scripts/formation/weather.mjs");
    const cm = acksExtras.lib.tables.getDoc("weather")?.tables?.climateModifiers ?? {};
    const usable = Object.keys(cm).filter((k) => W.CLIMATES[k] && cm[k]?.winter && cm[k]?.spring);
    return { climate: usable.includes(want) ? want : usable[0] ?? null, usable: usable.length, ready: W.generatorReady() };
  },

  skyRoll: async ({ partyId, fid }) => {
    const H = globalThis.__p2b;
    const app = game.actors.get(partyId).sheet;
    const btn = H.root(app)?.querySelector('[data-action="travelWeatherRoll"]');
    if (!btn) return { found: false };
    const before = foundry.utils.deepClone(game.settings.get("acks-extras", "skyCache") ?? {});
    const today = H.m.worldTime.calendarDay();
    btn.click();
    await H.sleep(3000);
    const after = game.settings.get("acks-extras", "skyCache") ?? {};
    const t = H.T.travelOf(H.formation(fid));
    const climate = t.weather.climate ?? "";
    const added = Object.keys(after).filter((k) => !(k in before));
    const todays = Object.keys(after).filter((k) => k.split("|")[0] === String(today) && k.split("|")[1] === climate);
    const dayZeroAdded = added.filter((k) => k.startsWith("0|"));
    const tookTodays = todays.some((k) => after[k]?.temperature === t.weather.temperature);
    await game.settings.set("acks-extras", "skyCache", before);
    const restored = JSON.stringify(game.settings.get("acks-extras", "skyCache") ?? {}) === JSON.stringify(before);
    return { found: true, today, climate, added, todays, dayZeroAdded, tookTodays, temperature: t.weather.temperature, restored };
  },

  /** Close and reopen the sheet, then measure every visible select's box against its content. */
  reopenSelects: async ({ partyId }) => {
    const H = globalThis.__p2b;
    const actor = game.actors.get(partyId);
    await actor.sheet.close();
    await H.sleep(600);
    await actor.sheet.render(true);
    await H.sleep(2500);
    const el = H.root(actor.sheet);
    const selects = [];
    for (const s of el.querySelectorAll("select")) {
      if (s.offsetParent === null) continue;
      const cs = getComputedStyle(s);
      selects.push({ name: s.getAttribute("name") ?? s.className, client: s.clientHeight, scroll: s.scrollHeight, h: Math.round(s.getBoundingClientRect().height * 10) / 10, font: cs.fontSize, over: s.scrollHeight > s.clientHeight + 1 });
    }
    const rs = getComputedStyle(el);
    return { k: rs.getPropertyValue("--acks-extras-k").trim(), inputHeight: rs.getPropertyValue("--input-height").trim(), fieldHeight: rs.getPropertyValue("--form-field-height").trim(), selects };
  },

  /** What the OPEN sheet holds: its sections, its selects by name, and whether Roll weather is drawn. */
  selectNames: async ({ partyId }) => {
    const H = globalThis.__p2b;
    const el = H.root(game.actors.get(partyId).sheet);
    if (!el) return { rendered: false };
    return {
      sections: [...el.querySelectorAll("[data-section]")].map((n) => n.dataset.section),
      selects: [...el.querySelectorAll("select")].map((x) => x.getAttribute("name") ?? x.className),
      weatherRoll: !!el.querySelector('[data-action="travelWeatherRoll"]'),
    };
  },

  setRadio: async ({ partyId, name, value }) => {
    const H = globalThis.__p2b;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const input = el?.querySelector(`input[name="${name}"][value="${value}"]`);
    if (!input) return { found: false };
    input.click();
    if (!input.checked) { input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true })); }
    await H.sleep(1200);
    return { found: true, checked: input.checked };
  },

  /** Press a button of the newest navigation card in the chat log, by class and formation. */
  pressCard: async ({ cls, fid }) => {
    const H = globalThis.__p2b;
    const buttons = [...document.querySelectorAll(`#chat-log .${cls}[data-formation-id="${fid}"], #chat .${cls}[data-formation-id="${fid}"]`)];
    const button = buttons[buttons.length - 1];
    if (!button) return { found: false, inLog: document.querySelectorAll("#chat-log .acks-extras-nav-card").length };
    H.takeNotes();
    const t0 = Date.now();
    button.click();
    await H.sleep(1500);
    return { found: true, disabled: button.disabled, notes: H.takeNotes(), messages: H.messagesSince(t0) };
  },

  /** The open dialog's buttons; press one, after setting a face where asked. */
  dialog: async ({ action = null, face = null }) => {
    const H = globalThis.__p2b;
    const dlg = [...document.querySelectorAll(".application.dialog, dialog, .dialog")].find((d) => d.querySelector("button[data-action]")) ?? null;
    if (!dlg) return { found: false };
    const actions = [...dlg.querySelectorAll("button[data-action]")].map((b) => b.dataset.action);
    if (face != null) { const sel = dlg.querySelector('select[name="face"]'); if (sel) H.change(sel, String(face)); }
    if (!action) return { found: true, actions };
    const b = dlg.querySelector(`button[data-action="${action}"]`);
    if (!b) return { found: true, actions, pressed: false };
    H.takeNotes();
    b.click();
    await H.sleep(1500);
    return { found: true, actions, pressed: true, notes: H.takeNotes() };
  },

  /** Press End day on the OPEN sheet and report its cards and the clock. */
  endDay: async ({ partyId }) => {
    const H = globalThis.__p2b;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const n = el?.querySelector('[data-action="travelEndDay"]');
    if (!n) return { found: false };
    const t0 = Date.now();
    const before = game.time.worldTime;
    n.click();
    await H.sleep(4000);
    const later = document.querySelector('.application.dialog button[data-action="later"], dialog button[data-action="later"]');
    if (later) { later.click(); await H.sleep(400); }
    return { found: true, messages: H.messagesSince(t0), worldTimeDelta: game.time.worldTime - before, calendarDay: H.m.worldTime.calendarDay() };
  },

  /** On the player seat: the party sheet as a player gets it, with the frame plate's pixels. */
  playerSheet: async ({ partyId, pId = null, qId = null }) => {
    const H = globalThis.__p2b;
    const party = game.actors.get(partyId);
    if (!party) return { rendered: false, reason: "no actor visible" };
    let app = null;
    try { app = await party.sheet.render(true); } catch (e) { return { rendered: false, reason: e.message }; }
    await H.sleep(2500);
    await app.render();
    await H.sleep(1800);
    const el = H.root(app);
    if (!el) return { rendered: false };
    const ctx = await app._prepareContext({});
    const tv = ctx.travel ?? {};
    const box = el.querySelector(".acks-extras-plate--frame");
    const canvasEl = box?.querySelector("canvas.acks-extras-plate__canvas");
    const country = el.querySelector('[data-section="country"]');
    let pix = null;
    if (canvasEl && tv.plate?.draw) {
      const scene = game.scenes.get(tv.plate.sceneId);
      const g = scene ? H.m.plate.plateGeometry(scene, tv.plate.center, 404, { points: tv.plate.points ?? [] }) : null;
      const c2 = canvasEl.getContext("2d");
      const px = (x, y) => [...c2.getImageData(Math.round(x), Math.round(y), 1, 1).data];
      const gold = H.rgb(getComputedStyle(canvasEl).getPropertyValue("--acks-extras-plate-point"));
      const p = pId ? g?.points.find((x) => x.id === pId) : null;
      const qg = qId && scene ? H.m.plate.plateGeometry(scene, tv.plate.center, 404, { points: [...(tv.plate.points ?? []), { id: qId, found: false }] }).points.find((x) => x.id === qId) : null;
      const ring = [];
      if (qg) for (let k = 0; k < 24; k++) { const a = (k / 24) * 2 * Math.PI; ring.push(px(qg.x + Math.cos(a) * 404 * 0.028, qg.y + Math.sin(a) * 404 * 0.028)); }
      pix = { gold, p: p ? H.near(px(p.x, p.y), gold) : null, qRingGold: ring.filter((s) => H.near(s, gold)).length, corner: px(2, 2) };
    }
    const out = {
      rendered: true,
      frame: { canvas: !!canvasEl, blank: !!box?.classList.contains("is-blank"), hex: box?.querySelector(".acks-extras-party-sheet__plate-hex")?.textContent.trim() ?? null, edit: !!box?.querySelector('[data-action="editPartyImage"]') },
      plate: tv.plate ? { draw: tv.plate.draw, blank: tv.plate.blank, points: (tv.plate.points ?? []).map((p) => ({ id: p.id, found: p.found })) } : null,
      pix,
      strip: { hex: ctx.strip?.hex ?? null, cadenceNext: ctx.strip?.cadence?.next ?? null },
      logHexes: (tv.log ?? []).map((e) => e.hex ?? null),
      stripDom: el.querySelector(".acks-extras-strip__hex, [data-strip='hex']")?.textContent.trim() ?? null,
      reading: ctx.frame?.reading ? { overline: ctx.frame.reading.overline ?? null, chips: (ctx.frame.reading.chips ?? []).map((c) => ({ key: c.key, label: c.label })) } : null,
      chipsDom: [...el.querySelectorAll(".acks-extras-party-sheet__chip")].map((c) => ({ cls: c.className, text: c.textContent.trim() })),
      country: {
        unknownDom: country?.querySelectorAll(".acks-extras-country-unknown").length ?? null,
        cardsDom: country?.querySelectorAll(".acks-extras-country-cards").length ?? null,
        cardCount: country?.querySelectorAll(".acks-extras-country-card").length ?? null,
        draw: country?.querySelector(".acks-extras-country-draw")?.textContent.trim() ?? null,
        overline: !!country?.querySelector(".acks-extras-shown-overline"),
        sources: country?.querySelectorAll(".acks-extras-country-source").length ?? null,
      },
      judgePart: !!el.querySelector('[data-application-part="judge"]'),
      hexStockDom: !!el.querySelector(".acks-extras-hex-stock-day"),
      shown: tv.shown ?? null, blank: tv.blank ?? null,
    };
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return out;
  },

  /** On the player seat: what of the scene's tokens a player can see, and whether a whispered card reached it. */
  playerCanvas: async ({ sceneId, fid, messageIds = [] }) => {
    const H = globalThis.__p2b;
    const scene = game.scenes.get(sceneId);
    const placeables = canvas.scene?.id === sceneId ? canvas.tokens.placeables : [];
    const visible = placeables.filter((t) => t.visible).map((t) => ({ id: t.id, shadow: !!t.document.getFlag("acks-extras", "shadowFor") }));
    const shadowDocs = (scene?.tokens ?? []).filter((t) => t.getFlag("acks-extras", "shadowFor") === fid).map((t) => ({ id: t.id, hidden: t.hidden }));
    return { viewed: canvas.scene?.id === sceneId, visible, shadowDocs, cards: messageIds.map((id) => { const m = game.messages.get(id); return { id, held: !!m, visible: m ? m.visible : null }; }), messages: game.messages.size };
  },

  /** On the player seat: messages the player can see since a count. */
  playerMessages: async ({ since }) => game.messages.contents.slice(since).map((m) => ({ id: m.id, whisper: m.whisper?.length ?? 0, text: new DOMParser().parseFromString(m.content ?? "", "text/html").body.textContent.trim().slice(0, 80) })),

  /** Put the seat's own client state back: dice, notifications, windows. */
  restoreSeat: async () => {
    const H = globalThis.__p2b;
    const out = {};
    if (H?.origUniform) { CONFIG.Dice.randomUniform = H.origUniform; H.origUniform = null; out.diceRestored = true; }
    try { ui.controls.activate({ control: "tokens", tool: "select" }); } catch (_e) { /* fine */ }
    if (H?.notesPatched) { for (const [k, fn] of Object.entries(H.orig)) ui.notifications[k] = fn; H.notesPatched = false; out.notesRestored = true; }
    return out;
  },

  closeAll: async () => {
    let n = 0;
    for (const a of [...foundry.applications.instances.values()]) if (/Party|Formation|Dialog|Sheet|Config|Palette|Assistant/.test(a.constructor.name)) { try { await a.close({ animate: false }); n++; } catch (_e) { /* closed */ } }
    return n;
  },
};

/* ------------------------------------------------------------------ */
/*  Node side                                                           */
/* ------------------------------------------------------------------ */

const page = async (api, fn, ...args) =>
  JSON.parse(await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`));

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation?.getFormations && !!globalThis.acksExtras?.battlemap?.country`);
    } catch {
      ok = false;
    }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const installP = (api) => api.eval(`globalThis.__P = {${Object.entries(P).map(([k, fn]) => `${k}: ${fn.toString()}`).join(",\n")}}; true`);

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key] });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  // The seat must run the working tree, not a cached copy: a function this change added is the marker.
  const fresh = await api.eval(`typeof globalThis.acksExtras?.formation?.travel?.trueTravelOf === "function" && globalThis.acksExtras?.formation?.apiVersion === 19`);
  if (!fresh) throw new Error(`${key}: stale module code loaded (trueTravelOf missing or apiVersion not 19); the page did not pick up the working tree`);
  note(`${key} runs the working tree`, fresh);
  await installP(api);
  return api;
}

const sceneData = (name, grid, extra = {}) => ({
  name, active: false, navigation: false, width: 2200, height: 1600, padding: 0, tokenVision: false, backgroundColor: "#8a8a8a",
  grid: { type: grid.type, size: CELL, distance: grid.distance ?? MILES, units: grid.units ?? "mi" },
  ownership: { default: 2 }, ...extra,
});

let registered = false;
let worldTime0 = null;
let encountersBefore = null;
try {
  section("seats");
  const gm = await seat("gm");
  const player = await seat("player");
  const census = { gm: await page(gm, P.census, MOD), player: await page(player, P.census, MOD) };
  note("gm census", census.gm);
  note("player census", { role: census.player.role, activeRoles: census.player.activeRoles });
  worldTime0 = census.gm.worldTime;
  check("the GM seat is the active GM and the player seat is a player", census.gm.activeGMIsSelf && census.gm.role === 4 && census.player.role === 1, { gmRole: census.gm.role, playerRole: census.player.role, activeRoles: census.gm.activeRoles });
  if (!census.gm.activeGMIsSelf) throw new Error("another GM client is the active GM; the throw would run there");
  note("install", { gm: await page(gm, P.install), player: await page(player, P.install) });
  const playerId = census.player.userId;

  section("fixtures");
  encountersBefore = census.gm.settings.travelEncounters;
  note("travelEncounters off", await page(gm, P.setSetting, { mod: MOD, key: "travelEncounters", value: false }));
  const hexScene = await gm.create("Scene", sceneData(`QA Shown hex ${NONCE}`, { type: 2 }));
  const otherScene = await gm.create("Scene", sceneData(`QA Shown other ${NONCE}`, { type: 1 }));
  note("background", await page(gm, P.setBackground, { sceneId: hexScene.id, src: "ui/parchment.jpg" }));
  note("hex scene viewed", await page(gm, P.viewScene, hexScene.id));
  const L = await page(gm, P.layout, { sceneId: hexScene.id });
  note("layout", { orientation: L.orientation, size: L.size, cells: Object.fromEntries(Object.entries(L.cells).map(([k, v]) => [k, v && { offset: v.offset, label: v.label }])) });
  check("the six hexes exist: A, B, D, E east of C in turn, T south-east of D", ["C", "A", "B", "D", "E", "T"].every((k) => !!L.cells[k]), Object.keys(L.cells));
  const cell = (k) => L.cells[k];
  const paintable = await page(gm, P.paintable);
  const tValue = paintable.terrain.find((v) => paintable.grounds[v] && paintable.grounds[v] !== "grassland" && !/^grass/i.test(v)) ?? paintable.terrain.find((v) => v !== "grassland") ?? null;
  const tGround = paintable.grounds[tValue] ?? null;
  check("the brush offers grassland and a second ground for T", paintable.terrain.includes("grassland") && !!tValue && !!tGround && tGround !== "grassland", { tValue, tGround, terrains: paintable.terrain.length });
  note("scene default", await page(gm, P.sceneDefault, { sceneId: hexScene.id, country: { ground: "grassland", territory: X } }));
  note("C terrain", await page(gm, P.paintAt, { sceneId: hexScene.id, point: cell("C").point, value: "grassland", layer: "terrain" }));
  note("T terrain", await page(gm, P.paintAt, { sceneId: hexScene.id, point: cell("T").point, value: tValue, layer: "terrain" }));
  const regions = await page(gm, P.regions, { sceneId: hexScene.id, layer: "terrain" });
  for (const r of regions) gm.track(r.uuid, "Region");
  note("regions tracked", regions.length);
  const road = await page(gm, P.roadWall, { sceneId: hexScene.id, c: [cell("C").point.x, cell("C").point.y, cell("A").point.x, cell("A").point.y], surface: "paved", from: cell("C").offset, to: cell("A").offset, off: cell("B").offset });
  gm.track(road.uuid, "Wall");
  note("road", road);
  check("the road is a paved wall; C-A steps on it and A-B does not", road.road?.surface === "paved" && road.on === true && road.offStep === false, road);
  const Cp = cell("C").point;
  const river = await page(gm, P.waterLine, { sceneId: hexScene.id, c: [Cp.x - L.size.sizeX / 2, Cp.y - L.size.sizeY / 4, Cp.x + L.size.sizeX / 2, Cp.y - L.size.sizeY / 4], kind: "river", navigable: false });
  gm.track(river.uuid, "Wall");
  note("river", river);
  check("the river is a wall flagged river, not navigable", river.water?.kind === "river" && river.water?.navigable === false, river.water);
  note("travel document", await page(gm, P.registerTravel, { X, miles: MILES, target: TARGET, grounds: ["grassland", tGround] }));
  registered = true;

  const party = await gm.create("Actor", { name: `QA Company ${NONCE}`, type: "acks-extras.party", ownership: { default: 0, [playerId]: 2 } });
  const memberA = await gm.create("Actor", { name: `QA Walker A ${NONCE}`, type: "character", ownership: { default: 0, [playerId]: 3 }, prototypeToken: { actorLink: true } });
  const memberB = await gm.create("Actor", { name: `QA Walker B ${NONCE}`, type: "character", prototypeToken: { actorLink: true } });
  const built = await page(gm, P.buildParty, { partyId: party.id, sceneId: hexScene.id, memberIds: [memberA.id, memberB.id], xy: cell("C").xy, mode: "journey" });
  note("party", built);
  if (built.error) throw new Error(built.error);
  gm.track(built.tokenUuid, "Token");
  const fid = built.formationId;
  check("the party journeys with two members enrolled and its token adopted", built.mode === "journey" && built.enrolled.every(Boolean) && built.partyTokenOf === built.tokenId, built);
  const stock = await page(gm, P.writeStock, { sceneId: hexScene.id, offset: cell("C").offset, label: cell("C").label, fid, X });
  note("stock", stock);
  check("hex C is stocked with P (found) and Q (unfound)", stock.back?.points === 2 && stock.back?.stocked === true, stock.back);
  const cal0 = await page(gm, P.calendar);
  note("calendar", cal0);

  let r;
  let s;
  const tracked = new Set();
  const trackMessages = (list) => { for (const m of list ?? []) { if (!tracked.has(m.uuid)) { gm.track(m.uuid, "ChatMessage"); tracked.add(m.uuid); } } };
  const navCards = (list) => (list ?? []).filter((m) => m.navCard);
  const sameNav = (a, b) => same(a, b);
  const gmIdsCheck = (m) => Array.isArray(m.whisper) && m.whisper.length > 0;

  section("1. the plate draws hex C");
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("sheet", { frame: s.frame, plate: s.plate, framePlateCtx: s.framePlateCtx, hexStock: s.hexStock, stockDay: s.stockDayDom, where: s.judge?.where, whereDom: s.whereDom });
  check("the frame holds a 404-square canvas plate with C's label and no image picker", s.frame.canvas && s.frame.width === 404 && s.frame.height === 404 && !s.frame.edit && s.frame.hex === cell("C").label, s.frame);
  if (SHOTS) note("placed", await page(gm, P.tab, { partyId: party.id, place: true }));
  await shot(gm, "formation-plate", ".application.acks-extras-party-sheet");
  await shot(gm, "formation-hex-stock-age", '[data-section="poi"]');
  const pix = await page(gm, P.pixels, { partyId: party.id, kind: "frame", pId: stock.pId, qId: stock.qId });
  note("pixels", pix);
  const tintC = await page(gm, P.colorFor, { value: "grassland" });
  check("the geometry is a hex of six vertices with one paved road, one river (not navigable) and two points; the tint is grassland's", pix.geometry?.kind === "hex" && pix.geometry?.vertices === 6 && same(pix.geometry?.roads, ["paved"]) && same(pix.geometry?.water, [{ kind: "river", navigable: false }]) && pix.geometry?.points === 2 && pix.tint === tintC, { geometry: pix.geometry, tint: pix.tint, tintC });
  check("the corner is transparent, most drawn pixels are opaque (the background arrived), and a plate with no background holds the tint at alpha 204", pix.corner?.[3] === 0 && pix.nonTransparent > 0 && pix.opaque / pix.nonTransparent > 0.8 && pix.bareAlpha === 204, { corner: pix.corner, nonTransparent: pix.nonTransparent, opaque: pix.opaque, bareAlpha: pix.bareAlpha });
  check("P's pixel is the point colour and Q's dashed ring shows the colour on some samples", pix.p?.isGold === true && (pix.q?.ringGold ?? 0) > 0, { p: pix.p, q: pix.q, gold: pix.gold });
  check("Where they are shows both plates labelled C, the same-hex line and no pad", s.whereDom?.truth.hex === cell("C").label && s.whereDom?.belief.hex === cell("C").label && !s.judge?.where.differ && !!s.whereDom?.same && s.whereDom?.pad.length === 0 && s.judge?.where.compass === null, { whereDom: s.whereDom, where: s.judge?.where });
  check("Points of interest reads Stocked today: the stock stamped at the clock's own time, age 0", s.hexStock?.stockedAgo === 0 && !!s.stockDayDom && /today/i.test(s.stockDayDom) && s.stockDayDom === s.hexStock?.stockedLine, { stockedAgo: s.hexStock?.stockedAgo, line: s.hexStock?.stockedLine, dom: s.stockDayDom, calendar: cal0 });
  note("player views the scene", await page(player, P.viewScene, hexScene.id));
  let ps = await page(player, P.playerSheet, { partyId: party.id, pId: stock.pId, qId: stock.qId });
  note("player sheet", ps);
  check("the player's frame plate draws with P alone, P's pixel the point colour and no ring round Q", ps.frame.canvas && ps.plate?.draw && ps.plate.points.length === 1 && ps.plate.points[0].id === stock.pId && ps.pix?.p === true && ps.pix?.qRingGold === 0, { frame: ps.frame, points: ps.plate?.points, pix: ps.pix });

  if (process.env.FIXES === "1") {
    section("fixes: the search's answers, the sky's day, the field box at 18 (GM seat)");
    note("mode tab", await page(gm, P.tab, { partyId: party.id, tab: "mode" }));
    note("selects on the sheet", await page(gm, P.selectNames, { partyId: party.id }));
    const sel = await page(gm, P.setSelect, { partyId: party.id, name: "travel.camp.present", value: "yes" });
    note("present -> yes", sel);
    const said = await page(gm, P.campSaid, { fid });
    check("fix: the Judge's yes is kept on the record and re-drawn after the submit", sel.found && sel.after === "yes" && said.present === "yes", { sel, said });
    const selT = await page(gm, P.setSelect, { partyId: party.id, name: "travel.camp.target", value: "elsewhere" });
    const saidT = await page(gm, P.campSaid, { fid });
    check("fix: so is what the search looks for", selT.found && selT.after === "elsewhere" && saidT.target === "elsewhere", { selT, saidT });
    const cl = await page(gm, P.pickClimate);
    note("climate", cl);
    if (!cl.climate || !cl.ready) throw new Error("no climate the imported weather document prices in two seasons, or the generator is not ready");
    note("override climate", await page(gm, P.setSelect, { partyId: party.id, name: "travel.override.climate", value: cl.climate }));
    const sky = await page(gm, P.skyRoll, { partyId: party.id, fid });
    note("roll weather", sky);
    check("fix: Roll weather files no sky under day 0, the party takes today's, and the cache is put back", sky.found && sky.climate === cl.climate && sky.dayZeroAdded.length === 0 && sky.today != null && sky.todays.length > 0 && sky.tookTodays && sky.restored, sky);
    const fs0 = (await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: 18 })).before;
    const m18 = await page(gm, P.reopenSelects, { partyId: party.id });
    const hs = (m) => [...new Set(m.selects.map((x) => x.h))].sort((a, b) => a - b);
    note("selects at 18", { k: m18.k, inputHeight: m18.inputHeight, fieldHeight: m18.fieldHeight, n: m18.selects.length, over: m18.selects.filter((x) => x.over), heights: hs(m18), boxed: m18.selects.filter((x) => x.h > 40).map((x) => x.name) });
    check("fix: at type size 18 no select clips its text and the fixed boxes ride the knob to 41.1", m18.selects.length > 0 && m18.selects.every((x) => !x.over) && m18.selects.some((x) => Math.abs(x.h - 41.1) <= 0.3) && m18.selects.every((x) => x.h <= 41.5), { n: m18.selects.length, over: m18.selects.filter((x) => x.over).map((x) => x.name), heights: hs(m18) });
    note("fontScale back", await page(gm, P.setSetting, { mod: MOD, key: "fontScale", value: fs0 ?? 14 }));
    const m14 = await page(gm, P.reopenSelects, { partyId: party.id });
    note("selects at base", { k: m14.k, inputHeight: m14.inputHeight, heights: hs(m14), over: m14.selects.filter((x) => x.over).map((x) => x.name) });
    check("fix: at the base size no select clips and the fixed boxes are the 32 they were", m14.selects.length > 0 && m14.selects.every((x) => !x.over) && m14.selects.some((x) => Math.abs(x.h - 32) <= 1) && m14.selects.every((x) => x.h <= 32.5), { heights: hs(m14) });
    s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  }

  if (process.env.ONLY_FIXES !== "1") {
  section("2. a drag on the road owes nothing");
  const d2 = await page(gm, P.drag, { fid, xy: cell("A").xy });
  trackMessages(d2.messages);
  note("drag C->A", d2);
  r = await page(gm, P.record, { fid });
  note("record", { map: r.map, navigation: r.navigation, owed: r.owed, dayKey: r.dayKey });
  check("the map's road is paved, no navigation card, the navigation record is empty", r.map?.road === "paved" && navCards(d2.messages).length === 0 && same(r.navigation, { thrownOn: null, lastResult: null, history: [] }), { road: r.map?.road, cards: navCards(d2.messages).length, navigation: r.navigation });
  check("navigationOwed reads following, route road, paved", r.owed?.state === "following" && r.owed?.route === "road" && r.owed?.road === "paved", r.owed);
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("navigation", s.navDom);
  check("Navigation, quietly's line reads following and names the paved road", s.navDom?.state === "following" && /paved/i.test(s.navDom?.line ?? ""), s.navDom);
  const p2 = await page(gm, P.press, { partyId: party.id, selector: '[data-action="navigationThrowNow"]' });
  trackMessages(p2.messages);
  note("throw now on the road", p2);
  r = await page(gm, P.record, { fid });
  check("Throw now on the road: an info toast, no card, no history row", p2.found && p2.notes.some((n) => n.kind === "info") && navCards(p2.messages).length === 0 && r.navigation.history.length === 0, { notes: p2.notes, cards: navCards(p2.messages).length, history: r.navigation.history.length });

  section("3. the day's first step off the road throws, once");
  note("rig 1", await page(gm, P.rig, { want: 1 }));
  const d3 = await page(gm, P.drag, { fid, xy: cell("B").xy });
  trackMessages(d3.messages);
  note("drag A->B", { messages: d3.messages, delta: d3.worldTimeDelta, notes: d3.notes, offer: d3.offer });
  r = await page(gm, P.record, { fid });
  note("record", { navigation: r.navigation, dayKey: r.dayKey, lost: r.lost, hex: r.hex });
  const card3 = navCards(d3.messages);
  check("ONE navigation card, whispered, a natural 1, the strayed verdict", card3.length === 1 && gmIdsCheck(card3[0]) && r.navigation.history[0]?.natural === 1 && r.navigation.history[0]?.success === false, { cards: card3, entry: r.navigation.history[0] });
  if (SHOTS) { note("chat fronted", await page(gm, P.tab, { partyId: party.id, chat: true, messageId: card3[0]?.id ?? null })); await shot(gm, "formation-navigation-card", `li.chat-message[data-message-id="${card3[0]?.id}"] .message-content`); }
  const keyShape = /^(\d+)?:\d+$/;
  check("thrownOn is today's string key (calendar:count) and history[0] is the step's throw in hex B with the day's count", typeof r.navigation.thrownOn === "string" && keyShape.test(r.navigation.thrownOn) && r.navigation.thrownOn === r.dayKey && r.navigation.history[0]?.day === r.dayKey && r.navigation.history[0]?.count === r.dayCount && r.navigation.history[0]?.hexLabel === cell("B").label && r.navigation.history[0]?.by === "step" && r.navigation.history[0]?.target === TARGET && r.navigation.lastResult?.natural === 1, { navigation: r.navigation, dayKey: r.dayKey, dayCount: r.dayCount });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("navigation", s.navDom);
  check("Navigation, quietly reads thrown today, with one strayed row for day count+1 in B by the step", s.navDom?.state === "thrown" && s.navDom?.rows.length === 1 && s.navDom.rows[0].strayed && s.navDom.rows[0].day?.includes(String((r.navigation.history[0]?.count ?? -9) + 1)) && s.navDom.rows[0].hex === cell("B").label && s.judge?.navigation.history[0]?.by && s.navDom.rows[0].by === s.judge.navigation.history[0].by, { navDom: s.navDom, history: s.judge?.navigation.history });

  section("4. the episode opens");
  const sh4 = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  note("shadow", sh4);
  if (sh4.shadow) gm.track(sh4.shadow.uuid, "Token");
  check("lost.phase is astray on the scene with B as the anchor; the card says the episode is open and carries no button", r.lost.phase === "astray" && r.lost.sceneId === hexScene.id && sameHex(r.lost.anchor, cell("B").offset) && card3[0]?.buttons === 0 && card3[0]?.hints.length >= 1, { lost: r.lost, card: card3[0] });
  check("a hidden shadow flagged for the formation stands in hex B", !!sh4.shadow && sh4.shadow.hidden === true && sameHex(sh4.shadow.offset, cell("B").offset) && sh4.count === 1, sh4);
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  const astrayChip = (chips) => chips.some((c) => /lost|astray|compass/i.test(c.cls) || /astray|lost/i.test(c.text));
  note("gm chips", s.chipsDom);
  const pc4 = await page(player, P.playerCanvas, { sceneId: hexScene.id, fid, messageIds: card3.map((m) => m.id) });
  ps = await page(player, P.playerSheet, { partyId: party.id });
  note("player", { chips: ps.chipsDom, canvas: pc4 });
  check("the GM's band wears the astray chip and the player's does not; the player's canvas shows no shadow and the card is not visible to the player", astrayChip(s.chipsDom) && !astrayChip(ps.chipsDom) && pc4.visible.every((t) => !t.shadow) && pc4.cards.every((c) => c.visible === false), { gm: s.chipsDom, player: ps.chipsDom, canvas: pc4 });

  section("5. a further drag moves the shadow with the token");
  const d5 = await page(gm, P.drag, { fid, xy: cell("D").xy });
  trackMessages(d5.messages);
  note("drag B->D", { messages: d5.messages, delta: d5.worldTimeDelta, offer: d5.offer });
  r = await page(gm, P.record, { fid });
  const sh5 = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  note("record", { lost: r.lost, hex: r.hex, shadow: sh5 });
  check("no new navigation card, and the shadow stands in hex D, the token's hex", navCards(d5.messages).length === 0 && sameHex(sh5.shadow?.offset, cell("D").offset) && sameHex(sh5.party?.offset, cell("D").offset), { cards: navCards(d5.messages).length, shadow: sh5.shadow?.offset, party: sh5.party?.offset });
  check("lost.faked holds D's key and observations the pair D/D", r.lost.faked.includes(cell("D").key) && r.lost.observations.some((o) => o.at === cell("D").key && o.shown === cell("D").key), r.lost);
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("where", { where: s.judge?.where, dom: s.whereDom });
  check("Where they are still says one hex, and the pad shows six direction cells round a dice cell", !s.judge?.where.differ && s.whereDom?.pad.length === 7 && s.whereDom.pad.includes("roll") && s.whereDom.pad.filter((d) => d !== "roll").length === 6, s.whereDom?.pad);

  section("6. shift the truth");
  const p6 = await page(gm, P.press, { partyId: party.id, selector: '[data-action="shiftTruth"][data-direction="se"]', settle: 3000 });
  note("press se", p6);
  r = await page(gm, P.record, { fid });
  const sh6 = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  note("after", { lost: r.lost, shadow: sh6 });
  check("the shadow stands in hex T and the party token has not moved", p6.found && sameHex(sh6.shadow?.offset, cell("T").offset) && sameHex(sh6.party?.offset, cell("D").offset), { shadow: sh6.shadow?.offset, party: sh6.party?.offset });
  check("observations gained the pair T/D", r.lost.observations.some((o) => o.at === cell("T").key && o.shown === cell("D").key), r.lost.observations);
  const pc6 = await page(player, P.playerCanvas, { sceneId: hexScene.id, fid });
  ps = await page(player, P.playerSheet, { partyId: party.id });
  check("nothing changed on the player seat: its plate reads D and no shadow is visible", ps.frame.hex === cell("D").label && pc6.visible.every((t) => !t.shadow), { hex: ps.frame.hex, visible: pc6.visible });

  section("7. the two plates differ, and the encounters follow the truth");
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("where", { where: s.judge?.where, dom: s.whereDom, draw: s.country.draw, previewDraw: s.shownDom?.previewDraw, trueGround: r.trueGround, ground: r.ground, trueTable: r.trueTable });
  check("the True plate is labelled T and the Believed plate D, dashed and gold (is-differ) with its caption", s.whereDom?.truth.hex === cell("T").label && s.whereDom?.belief.hex === cell("D").label && s.whereDom?.belief.differ && s.whereDom?.captionDiffer && !s.whereDom?.truth.differ, s.whereDom);
  check("the badge reads south-east and the context says differ with compass se", s.judge?.where.differ === true && s.judge?.where.compass?.dir === "se" && /south-east/i.test(s.whereDom?.compass ?? ""), { compass: s.whereDom?.compass, ctx: s.judge?.where.compass });
  check("each plate names its kind to a reader before its hex, so the two are told apart", !!s.whereDom?.truth.aria && !!s.whereDom?.belief.aria && s.whereDom.truth.aria.includes(cell("T").label) && s.whereDom.belief.aria.includes(cell("D").label) && s.whereDom.truth.aria.split(":")[0] !== s.whereDom.belief.aria.split(":")[0] && s.whereDom.truth.aria.indexOf(":") > 0, { truth: s.whereDom?.truth.aria, belief: s.whereDom?.belief.aria });
  check("the pad lays a row grid's six faces round the dice cell: the diagonals at the corners, west and east beside it", same(s.whereDom?.pad, ["nw", "ne", "w", "roll", "e", "sw", "se"]), s.whereDom?.pad);
  const tLabel = await page(gm, P.colorFor, { value: tValue }); // the tint only; the table label follows
  const tableT = await gm.eval(`(() => { const H = globalThis.__p2b; return JSON.stringify({ t: H.tableLabel(${JSON.stringify(tValue)}), g: H.tableLabel(H.m.encT.encounterTerrainFor("grassland")) }); })()`).then(JSON.parse);
  check("trueTravelOf's ground is T's and travelOf's grassland; the GM's Encounters line names T's table and the preview grassland's", r.trueGround === tGround && r.ground === "grassland" && !!tableT.t && (s.country.draw ?? "").includes(tableT.t) && !!tableT.g && (s.shownDom?.previewDraw ?? "").includes(tableT.g), { trueGround: r.trueGround, ground: r.ground, draw: s.country.draw, preview: s.shownDom?.previewDraw, labels: tableT, tLabel });
  check("Points of interest reads T's label with the astray note", s.hexStock?.label === cell("T").label && s.hexStock?.astray === true, s.hexStock);
  if (SHOTS) {
    await shot(gm, "formation-true-encounters", '[data-section="country"]');
    note("tab judge", await page(gm, P.tab, { partyId: party.id, tab: "judge" }));
    await shot(gm, "formation-where-they-are", '[data-section="where"]');
    note("tab mode", await page(gm, P.tab, { partyId: party.id, tab: "mode" }));
  }
  const d7 = await page(gm, P.drag, { fid, xy: cell("E").xy });
  trackMessages(d7.messages);
  note("drag D->E", { messages: d7.messages, delta: d7.worldTimeDelta, offer: d7.offer });
  const sh7 = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  const tEast = await gm.eval(`(() => { const H = globalThis.__p2b; const n = H.m.plate.neighbourToward(game.scenes.get(${JSON.stringify(hexScene.id)}), ${JSON.stringify(cell("T").offset)}, "e"); return JSON.stringify(n ? { i: n.i, j: n.j } : null); })()`).then(JSON.parse);
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("the shadow moved one hex east of T and the badge still reads south-east", sameHex(sh7.shadow?.offset, tEast) && s.judge?.where.compass?.dir === "se" && navCards(d7.messages).length === 0, { shadow: sh7.shadow?.offset, tEast, compass: s.judge?.where.compass, cards: navCards(d7.messages).length });
  const p7 = await page(gm, P.press, { partyId: party.id, selector: '[data-action="shiftTruth"][data-direction="roll"]', settle: 3500 });
  note("press roll", p7);
  const sh7b = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  const dist = await gm.eval(`(() => { const g = game.scenes.get(${JSON.stringify(hexScene.id)}).grid; return g.measurePath([g.getCenterPoint(${JSON.stringify(sh7.shadow?.offset)}), g.getCenterPoint(${JSON.stringify(sh7b.shadow?.offset)})]).spaces; })()`);
  check("the dice cell: a toast names the face and the shadow stands one hex from where it was", p7.found && p7.notes.some((n) => n.kind === "info") && Number(dist) === 1, { notes: p7.notes, from: sh7.shadow?.offset, to: sh7b.shadow?.offset, dist });

  section("8. unknown country, from the player seat");
  const radio8 = await page(gm, P.setRadio, { partyId: party.id, name: "travel.shown", value: "unknown" });
  note("radio unknown", radio8);
  r = await page(gm, P.record, { fid });
  check("travel.shown is unknown", radio8.found && r.shown === "unknown" && r.stored.shown === "unknown", { shown: r.shown, stored: r.stored.shown });
  ps = await page(player, P.playerSheet, { partyId: party.id });
  note("player sheet", ps);
  check("the player's frame plate is blank with no canvas and no label; the strip's hex label is empty", ps.frame.blank && !ps.frame.canvas && !ps.frame.hex && ps.strip?.hex?.label === "", { frame: ps.frame, strip: ps.strip });
  check("the player's reading names no hex", !(ps.reading?.overline ?? "").includes(cell("E").label), { overline: ps.reading?.overline });
  check("the player's strip counts no miles to the next throw under unknown country", ps.strip?.cadenceNext === "", { strip: ps.strip });
  check("the player's reading chips carry no territory or following", !(ps.reading?.chips ?? []).some((c) => c.key === "territory" || c.key === "following"), ps.reading?.chips);
  check("the player's Country section holds exactly one unknown line and no cards", ps.country.unknownDom === 1 && ps.country.cardsDom === 0 && ps.country.cardCount === 0, ps.country);
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("gm sheet", { country: s.country, frame: s.frame, hexField: s.hexField, preview: s.judge?.preview, previewDom: s.shownDom });
  check("the GM's Wilderness tab shows the one line beneath the overline, a blank frame plate, and the hex field still holds E's label", s.country.overline && s.country.unknownDom === 1 && s.country.cardsDom === 0 && s.frame.blank && !s.frame.canvas && s.hexField === cell("E").label, { country: s.country, frame: s.frame, hexField: s.hexField });
  check("the GM's strip keeps its count of miles to the next throw", typeof s.strip?.cadenceNext === "string" ? s.strip.cadenceNext !== "" : s.strip?.cadenceNext != null, { strip: s.strip });
  check("the Judge tab's preview shows the blank plate and the one line", s.shownDom?.previewPlate.blank && !s.shownDom?.previewPlate.canvas && s.shownDom?.previewUnknown === 1 && s.shownDom?.previewCards === 0 && s.judge?.preview.blank === true, s.shownDom);
  if (SHOTS) {
    note("tab judge", await page(gm, P.tab, { partyId: party.id, tab: "judge" }));
    await shot(gm, "formation-shown-unknown", '[data-section="shown"]');
    note("tab mode", await page(gm, P.tab, { partyId: party.id, tab: "mode" }));
  }
  const r8 = await page(gm, P.record, { fid });
  check("trueTravelOf is what it was", r8.trueGround === r.trueGround && sameHex(r8.trueHex, r.trueHex), { before: r.trueHex, after: r8.trueHex });
  note("radio believed", await page(gm, P.setRadio, { partyId: party.id, name: "travel.shown", value: "believed" }));
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  ps = await page(player, P.playerSheet, { partyId: party.id });
  check("the believed tile: every seat draws again", s.frame.canvas && !s.frame.blank && ps.frame.canvas && !ps.frame.blank && ps.country.cardCount > 0, { gm: s.frame, player: ps.frame, cards: ps.country.cardCount });

  section("9. they realise they are lost");
  note("rig 20", await page(gm, P.rig, { want: 20 }));
  const pmBefore = (await page(player, P.census, MOD)).messages;
  const p9 = await page(gm, P.press, { partyId: party.id, selector: '[data-action="navigationThrowNow"]', settle: 2000 });
  trackMessages(p9.messages);
  note("throw now astray", p9);
  r = await page(gm, P.record, { fid });
  const card9 = navCards(p9.messages);
  const day3 = r.navigation.history.find((e) => e.by === "step")?.day ?? null;
  check("one card, kept while astray, with the realise button; history[0] by judge on step 3's day; thrownOn unchanged; phase still astray", card9.length === 1 && card9[0].realise && !card9[0].begin && r.navigation.history[0]?.by === "judge" && r.navigation.history[0]?.success === true && r.navigation.history[0]?.day === day3 && r.navigation.thrownOn === day3 && r.lost.phase === "astray", { cards: card9, history: r.navigation.history.slice(0, 2), thrownOn: r.navigation.thrownOn, phase: r.lost.phase });
  const sh9 = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  const pr9 = await page(gm, P.pressCard, { cls: "acks-extras-nav-realise", fid });
  trackMessages(pr9.messages);
  note("press realise", pr9);
  r = await page(gm, P.record, { fid });
  const sh9b = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  const pmAfter = await page(player, P.playerMessages, { since: pmBefore });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("after realise", { lost: r.lost, shadow: sh9b.shadow?.offset, playerMessages: pmAfter, where: s.judge?.where });
  check("the episode is aware with faked and observations empty, the shadow where it stood, and the players told", pr9.found && r.lost.phase === "aware" && r.lost.faked.length === 0 && r.lost.observations.length === 0 && sameHex(sh9b.shadow?.offset, sh9.shadow?.offset) && pmAfter.length >= 1, { lost: r.lost, shadow: sh9b.shadow?.offset, before: sh9.shadow?.offset, playerMessages: pmAfter.length });
  check("Where they are still shows two plates that differ", s.judge?.where.differ === true && s.whereDom?.belief.differ, s.judge?.where);
  if (SHOTS) {
    note("tab judge", await page(gm, P.tab, { partyId: party.id, tab: "judge" }));
    await shot(gm, "formation-navigation-quietly", '[data-section="navigation"]');
    await shot(gm, "formation-lost-aware", '[data-section="episode"]');
    note("tab mode", await page(gm, P.tab, { partyId: party.id, tab: "mode" }));
  }
  const pr9b = await page(gm, P.pressCard, { cls: "acks-extras-nav-realise", fid });
  const r9b = await page(gm, P.record, { fid });
  check("a second press does nothing", r9b.lost.phase === "aware" && same(r9b.lost, r.lost), { found: pr9b.found, disabled: pr9b.disabled });

  section("10. the next day, aware");
  note("unrig", await page(gm, P.unrig));
  const calA = await page(gm, P.calendar);
  const ed = await page(gm, P.endDay, { partyId: party.id });
  trackMessages(ed.messages);
  note("end day", { messages: ed.messages.length, navCards: navCards(ed.messages).length, delta: ed.worldTimeDelta, calendarDay: ed.calendarDay, advanceWorldTime: census.gm.settings.advanceWorldTime });
  r = await page(gm, P.record, { fid });
  const keyParts = (k) => (typeof k === "string" ? k.split(":") : [null, null]);
  check("End day posts no navigation card and thrownOn is unchanged", navCards(ed.messages).length === 0 && r.navigation.thrownOn === day3, { cards: navCards(ed.messages).length, thrownOn: r.navigation.thrownOn, day3 });
  let advanced = ed.worldTimeDelta;
  const calB = await page(gm, P.calendar);
  note("clock moved by End day (s)", { advanced, before: calA, after: calB });
  const keyB = r.dayKey;
  check("End day turned the key: its count half is one up on the throw's, whatever the calendar did", keyShape.test(keyB) && Number(keyParts(keyB)[1]) === Number(keyParts(day3)[1]) + 1 && keyB !== day3, { day3, keyB, calendarBefore: calA.calendarDay, calendarAfter: calB.calendarDay });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  note("navigation", s.navDom);
  check("Navigation, quietly reads owed at the day's first step off the road", s.navDom?.state === "owed" && !!s.navDom?.line, s.navDom);
  check("the day log's rows name their hex while the party is shown the believed hex", s.logHexes.length >= 1 && s.logHexes.every((h) => typeof h === "string" && h.length > 0), { logHexes: s.logHexes });
  note("rig 1", await page(gm, P.rig, { want: 1 }));
  const p10 = await page(gm, P.press, { partyId: party.id, selector: '[data-action="travelEnterHex"]', settle: 2500 });
  trackMessages(p10.messages);
  note("next hex", { messages: p10.messages, notes: p10.notes });
  r = await page(gm, P.record, { fid });
  const sh10 = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  const card10 = navCards(p10.messages);
  check("Next hex: one card for the aware party with no button; one shadow; thrownOn the new day's key with its count; history[0] by step", card10.length === 1 && card10[0].buttons === 0 && sh10.count === 1 && r.navigation.thrownOn === keyB && r.navigation.history[0]?.by === "step" && r.navigation.history[0]?.day === keyB && r.navigation.history[0]?.count === r.dayCount, { cards: card10, shadows: sh10.count, thrownOn: r.navigation.thrownOn, keyB, entry: r.navigation.history[0], dayCount: r.dayCount });
  const d10 = await page(gm, P.drag, { fid, xy: cell("D").xy });
  trackMessages(d10.messages);
  const sh10b = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  const westOf = await gm.eval(`(() => { const H = globalThis.__p2b; const n = H.m.plate.neighbourToward(game.scenes.get(${JSON.stringify(hexScene.id)}), ${JSON.stringify(sh10.shadow?.offset)}, "w"); return JSON.stringify(n ? { i: n.i, j: n.j } : null); })()`).then(JSON.parse);
  note("drag E->D", { messages: d10.messages, from: sh10.shadow?.offset, to: sh10b.shadow?.offset, westOf });
  check("the drag back: no card, and the shadow moved one hex west", navCards(d10.messages).length === 0 && sameHex(sh10b.shadow?.offset, westOf), { cards: navCards(d10.messages).length, to: sh10b.shadow?.offset, westOf });
  // Midnight with the day open: the calendar half turns, the count half does not, and the next step owes the new day's throw.
  const calC = await page(gm, P.calendar);
  const toMidnight = calC.secondsPerDay - (calC.worldTime % calC.secondsPerDay) + 60;
  const advC = await page(gm, P.advanceClock, { seconds: toMidnight });
  advanced += advC.after - advC.before;
  const calD = await page(gm, P.calendar);
  note("clock advanced past midnight by hand", { seconds: toMidnight, advC, calC, calD, total: advanced });
  check("the calendar day moved on by one and the count did not", calD.calendarDay === calC.calendarDay + 1 && (await page(gm, P.record, { fid })).dayCount === r.dayCount, { before: calC.calendarDay, after: calD.calendarDay });
  const rPre = await page(gm, P.record, { fid });
  check("the new key's calendar half is the new day's and its count half the old", keyParts(rPre.dayKey)[0] === String(calD.calendarDay) && keyParts(rPre.dayKey)[1] === keyParts(keyB)[1] && rPre.owed?.state === "owed", { dayKey: rPre.dayKey, keyB, owed: rPre.owed });
  note("rig 1", await page(gm, P.rig, { want: 1 }));
  const d10b = await page(gm, P.drag, { fid, xy: cell("E").xy });
  trackMessages(d10b.messages);
  r = await page(gm, P.record, { fid });
  const sh10c = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  const eastOf = await gm.eval(`(() => { const H = globalThis.__p2b; const n = H.m.plate.neighbourToward(game.scenes.get(${JSON.stringify(hexScene.id)}), ${JSON.stringify(sh10b.shadow?.offset)}, "e"); return JSON.stringify(n ? { i: n.i, j: n.j } : null); })()`).then(JSON.parse);
  note("drag D->E past midnight", { messages: d10b.messages, offer: d10b.offer, from: sh10b.shadow?.offset, to: sh10c.shadow?.offset, eastOf, thrownOn: r.navigation.thrownOn });
  check("the step after midnight throws for the new calendar day under the open count, and the shadow stands one hex east", navCards(d10b.messages).length === 1 && r.navigation.thrownOn === rPre.dayKey && r.navigation.history[0]?.day === rPre.dayKey && r.navigation.history[0]?.count === r.dayCount && sameHex(sh10c.shadow?.offset, eastOf), { cards: navCards(d10b.messages).length, thrownOn: r.navigation.thrownOn, expected: rPre.dayKey, entry: r.navigation.history[0], to: sh10c.shadow?.offset, eastOf });

  section("11. the refused opening, and the card's Begin");
  const p11 = await page(gm, P.press, { partyId: party.id, selector: '[data-action="lostEnd"]', settle: 800 });
  note("press lostEnd", p11);
  const dlg11 = await page(gm, P.dialog, { action: "yes" });
  note("confirm", dlg11);
  r = await page(gm, P.record, { fid });
  const sh11 = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("They turn back: lost.phase null, no shadow anywhere, both plates read the party token's hex, no pad", dlg11.pressed && r.lost.phase === null && sh11.count === 0 && !sh11.shadow && s.whereDom?.truth.hex === s.whereDom?.belief.hex && s.whereDom?.truth.hex === cell("E").label && s.whereDom?.pad.length === 0, { lost: r.lost, shadows: sh11.count, whereDom: s.whereDom });
  note("other scene viewed", await page(gm, P.viewScene, otherScene.id));
  note("rig 1", await page(gm, P.rig, { want: 1 }));
  const p11b = await page(gm, P.press, { partyId: party.id, selector: '[data-action="navigationThrowNow"]', settle: 2000 });
  trackMessages(p11b.messages);
  note("throw now off the scene", p11b);
  r = await page(gm, P.record, { fid });
  const card11 = navCards(p11b.messages);
  const sh11b = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  check("a warning to open the party's scene, one strayed card saying the episode could not open, with the Begin button; no episode, no shadow", p11b.notes.some((n) => n.kind === "warn") && card11.length === 1 && card11[0].begin && card11[0].hints.length >= 2 && r.lost.phase === null && sh11b.count === 0, { notes: p11b.notes, cards: card11, phase: r.lost.phase, shadows: sh11b.count });
  const pr11a = await page(gm, P.pressCard, { cls: "acks-extras-nav-begin", fid });
  note("press begin off the scene", pr11a);
  const r11a = await page(gm, P.record, { fid });
  const sh11a = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  check("Begin pressed while viewing the other scene: the same warning, nothing opens, the button stays", pr11a.found && pr11a.notes.some((n) => n.kind === "warn") && r11a.lost.phase === null && sh11a.count === 0 && pr11a.disabled === false, { notes: pr11a.notes, phase: r11a.lost.phase, shadows: sh11a.count, disabled: pr11a.disabled });
  note("hex scene viewed", await page(gm, P.viewScene, hexScene.id));
  const pr11 = await page(gm, P.pressCard, { cls: "acks-extras-nav-begin", fid });
  note("press begin", pr11);
  const dlgAfter = await page(gm, P.dialog, {});
  note("dialog after begin", dlgAfter);
  r = await page(gm, P.record, { fid });
  const sh11c = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  if (sh11c.shadow) gm.track(sh11c.shadow.uuid, "Token");
  s = await page(gm, P.sheet, { partyId: party.id, keep: true });
  check("Begin on the party's scene: no dialog; the episode opens astray with the shadow in the party token's own hex, both plates the same hex, no badge, and the pad shown", pr11.found && !dlgAfter.found && r.lost.phase === "astray" && r.lost.sceneId === hexScene.id && !!sh11c.shadow && sameHex(sh11c.shadow.offset, sh11c.party?.offset) && sameHex(r.lost.anchor, sh11c.party?.offset) && s.judge?.where.differ === false && s.judge?.where.compass === null && s.whereDom?.truth.hex === s.whereDom?.belief.hex && s.whereDom?.pad.length === 7, { phase: r.lost.phase, anchor: r.lost.anchor, shadow: sh11c.shadow?.offset, party: sh11c.party?.offset, where: s.judge?.where, pad: s.whereDom?.pad, dialog: dlgAfter });
  const p11c = await page(gm, P.press, { partyId: party.id, selector: '[data-action="lostEnd"]', settle: 800 });
  const dlg11c = await page(gm, P.dialog, { action: "yes" });
  r = await page(gm, P.record, { fid });
  const sh11d = await page(gm, P.shadow, { sceneId: hexScene.id, fid });
  check("They turn back again: no episode, no shadow", p11c.found && dlg11c.pressed && r.lost.phase === null && sh11d.count === 0, { phase: r.lost.phase, shadows: sh11d.count });

  }
  note("closed", await page(gm, P.closeAll));
} catch (err) {
  console.error("WALK FAILED:", err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = seats.gm;
  try { if (gm) note("closed windows", { gm: await page(gm, P.closeAll), player: seats.player ? await page(seats.player, P.closeAll) : 0 }); } catch (err) { console.error("closeAll:", err?.message ?? err); }
  try { if (gm) note("dice restored", await page(gm, P.unrig)); } catch (err) { console.error("unrig:", err?.message ?? err); }
  try { if (gm && registered) note("travel document unregistered", await page(gm, P.unregisterTravel)); } catch (err) { console.error("unregister:", err?.message ?? err); }
  try { if (gm && encountersBefore != null) note("travelEncounters restored", await page(gm, P.setSetting, { mod: MOD, key: "travelEncounters", value: encountersBefore })); } catch (err) { console.error("setting:", err?.message ?? err); }
  try { if (gm) note("seat restored", await page(gm, P.restoreSeat)); } catch (err) { console.error("restoreSeat:", err?.message ?? err); }
  try { if (seats.player) note("player seat restored", await page(seats.player, P.restoreSeat)); } catch (err) { console.error("restoreSeat player:", err?.message ?? err); }
  try { if (gm) note("sweep", await gm.sweepTracked()); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (gm && worldTime0 != null) note("worldTime delta (s)", (await page(gm, P.census, MOD)).worldTime - worldTime0); } catch (err) { console.error("worldTime:", err?.message ?? err); }
  console.log("\n== summary ==");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed`);
  if (failed) process.exitCode = 1;
  for (const api of Object.values(seats)) { try { api.close(); } catch (_e) { /* closed */ } }
}
