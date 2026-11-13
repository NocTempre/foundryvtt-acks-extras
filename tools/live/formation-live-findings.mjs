/**
 * Live walk: docs/formation/TESTING.md "Billing at the dark rate" and "A light
 * change reaches both seats". The GM seat is the active GM and the primary
 * automation client; the Player seat owns the column party's members and only
 * watches.
 *
 * Covers:
 *   "Billing at the dark rate": a wall-constrained move on a dark, walled scene
 *       is billed at the party's in-the-dark rate, and the same kind of move
 *       with a light lit at the lit rate. Reads, without writing, the darkness
 *       of every imported level carrying the importer's map id `ax1.level2Map`.
 *   "A light change reaches both seats": a two-seat recorder times each
 *       shutter, open, douse and relight from the GM's click to the moment the
 *       change lands on each seat, in both orders, cold (the first actions
 *       after the Player's reload) and settled.
 *
 * Every fixture is invented and every figure printed is a measurement or a
 * boolean. Fixtures, kept and found again by marker (`api.fixture`): the
 * replica scene `formation/t0361-delve@t0363` (dark, one wall; its tag is
 * a second ledger's own), the party `formation/t0361-party` with
 * `formation/t0361-a` and `formation/t0361-b`; and the column's own set,
 * `formation/column-scene`, `formation/column-party`, `formation/column-lead`,
 * `formation/column-torch` and `formation/column-lantern`. Each section brings
 * what it reads to shape at its start. The party token the first section
 * places and the cards the run's own moves posted are tracked by id and swept.
 */
import { connect, sleep, fixtureLedger } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const SCOPE = "acks-extras";
/** The run's tag on the chat cards this GM client creates, so a card is claimed only from this run. */
const NONCE = "lf" + Math.random().toString(36).slice(2, 7);
/** A change that reaches a seat later than this many ms counts as late. A measurement parameter, not a figure from a book. */
const LATE_MS = 500;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/** Added to every document a seat loads: errors from the first script on, each with its phase. */
const RECORDER = `(() => {
  const R = (globalThis.__lfBoot = { phase: "load", phases: [], errors: [] });
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

/* The dark replica: a 70 px grid of 10 ft; the party stands at START, a wall stands across its row, and a move east is constrained by it. */
const GRID = 70;
const START = { x: 10 * GRID, y: 10 * GRID };
const WALL = [14 * GRID, 8 * GRID, 14 * GRID, 13 * GRID];
const EAST = 12 * GRID;
const BACK = 4 * GRID;

/* The column's corridor, as the column walk lays it: a 100 px, 5 ft grid. */
const GS = 100;
const WALLS = [
  [100, 100, 700, 100], [700, 100, 700, 700], [700, 700, 500, 700],
  [500, 700, 500, 300], [500, 300, 100, 300], [100, 300, 100, 100],
];
const COLUMN_START = { x: 3 * GS, y: 1 * GS };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    role: game.user.role,
    userId: game.user.id,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    active: game.users.filter((u) => u.active).map((u) => u.role),
    boot: globalThis.__lfBoot ?? null,
  }),

  install: async ({ nonce }) => {
    const H = (globalThis.__lf = globalThis.__lf ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.cl = await import(`${base}formation/column-light.mjs`);
    H.te = await import(`${base}formation/turn-engine.mjs`);
    H.light = await import(`${base}lib/light.mjs`);
    H.consts = await import(`${base}lib/constants.mjs`);
    H.units = await import(`${base}lib/distance-units.mjs`);
    H.F = acksExtras.formation;
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    if (!H.cardsArmed && game.user.isGM) {
      H.cardsArmed = true;
      H.cards = [];
      Hooks.on("preCreateChatMessage", (doc, _data, _opts, userId) => {
        if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce });
      });
      Hooks.on("createChatMessage", (m) => {
        if (m.flags?.world?.qaNonce !== nonce) return;
        const box = document.createElement("div");
        box.innerHTML = `${m.flavor ?? ""} ${m.content ?? ""}`;
        H.cards.push({ id: m.id, alias: m.speaker?.alias ?? null, text: box.textContent });
      });
    }
    return { ok: typeof H.F?.addLight === "function" };
  },

  /** Every imported level carrying the importer's map id: its darkness and whether it is walled, read and never written. */
  levels: async ({ mapId }) => game.scenes.contents
    .filter((s) => s.flags?.["acks-extras"]?.cookbook?.id === mapId)
    .map((s) => ({ id: s.id, darkness: s.environment?.darknessLevel ?? null, lock: !!s.environment?.darknessLock, walls: s.walls.size, tokenVision: !!s.tokenVision })),

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    return { scene: canvas.scene?.id === sceneId };
  },

  /** A scene's walls, made where a kept scene lost them. */
  walls: async ({ sceneId, segments }) => {
    const scene = game.scenes.get(sceneId);
    const have = new Set(scene.walls.map((w) => w.c.join(",")));
    const missing = segments.filter((c) => !have.has(c.join(",")));
    if (missing.length) await scene.createEmbeddedDocuments("Wall", missing.map((c) => ({ c })));
    return { walls: scene.walls.size, made: missing.length };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__lf;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** Seat the members through the party sheet's drop, in order; a member out of order is taken out and dropped again. */
  seat: async ({ partyId, fid, actorIds }) => {
    const H = globalThis.__lf;
    const ids = () => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    const now = ids();
    const prefixOk = actorIds.every((id, i) => now[i] === id) && now.length === actorIds.length;
    if (!prefixOk) {
      for (const id of now) await H.model.removeMember(H.model.getFormation(fid), id);
      const sheet = game.actors.get(partyId).sheet;
      await sheet.render(true);
      await H.sleep(900);
      for (const id of actorIds) {
        const dt = new DataTransfer();
        dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(id).uuid }));
        H.root(sheet).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
        await H.poll(() => ids().includes(id), { tries: 40, every: 150 });
      }
      try { await sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    }
    return { members: ids(), reseated: !prefixOk };
  },

  /** A token's source data for the party actor at a point, ready for a create. */
  tokenData: async ({ partyId, x, y }) => {
    const doc = await game.actors.get(partyId).getTokenDocument({ x, y });
    return { ...doc.toObject(), actorLink: true, hidden: false };
  },

  /** The token created, the record adopted it: the record's token id is the token's, and the clock starts fresh from the token's stored corner with no lights. */
  adopt: async ({ fid, tokenId, sceneId }) => {
    const H = globalThis.__lf;
    const adopted = await H.poll(() => H.model.getFormation(fid)?.tokenId === tokenId, { tries: 60, every: 200 });
    const tok = game.scenes.get(sceneId).tokens.get(tokenId);
    await H.model.patchFormation(fid, (r) => {
      delete r.travel;
      r.combat = null;
      r.lights = [];
      r.clock = { turnsTotal: 0, roundsPartial: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false, lastPosition: { x: tok._source.x, y: tok._source.y } };
    });
    await H.sleep(900);
    const f = H.model.getFormation(fid);
    return { adopted: !!adopted, sceneId: f.sceneId, tokenId: f.tokenId, mode: H.F.travel.travelOf(f).mode, members: f.members.filter((m) => m?.actorId).length };
  },

  /** What the module reads for the party's speed and darkness, and the clock, beside the token's stored corner. */
  snap: async ({ fid }) => {
    const H = globalThis.__lf;
    const f = H.model.getFormation(fid);
    const scene = game.scenes.get(f.sceneId);
    const tok = scene.tokens.get(f.tokenId);
    return {
      src: { x: tok._source.x, y: tok._source.y },
      clock: { ...f.clock },
      sceneDarkness: scene.environment?.darknessLevel ?? null,
      sceneDark: H.model.sceneIsDark(scene),
      partyInDark: H.model.isPartyInDark(f),
      effectiveSpeed: H.model.effectiveSpeed(f),
      turnFeet: H.te.turnDistance(f, scene),
      lights: (f.lights ?? []).map((l) => ({ type: l.type, lit: !!l.lit, shielded: !!l.shielded })),
      rounds: H.consts.ROUNDS_PER_TURN,
      feetPerCell: H.units.sceneFeetPerCell(scene) || scene.grid.distance,
      cell: scene.grid.size,
    };
  },

  /** Light a torch on a member as the party sheet's Add light does, with the fuel check overridden. */
  light: async ({ fid, bearerId }) => {
    const H = globalThis.__lf;
    await H.F.addLight(H.model.getFormation(fid), "torch", bearerId, { override: true });
    await H.sleep(1200);
    return { lit: H.model.getFormation(fid).lights.some((l) => l.bearerId === bearerId && l.lit) };
  },

  /** The token moved by `dx` as a hand's update does, from the GM's drawing client; resolves when the clock's baseline follows the stored corner. */
  move: async ({ fid, dx }) => {
    const H = globalThis.__lf;
    const f0 = H.model.getFormation(fid);
    const tok = game.scenes.get(f0.sceneId).tokens.get(f0.tokenId);
    const drawn = !!tok.object;
    await tok.update({ x: tok._source.x + dx }, { animate: false });
    const landed = await H.poll(() => {
      const lp = H.model.getFormation(fid).clock.lastPosition;
      return lp && lp.x === tok._source.x && lp.y === tok._source.y;
    }, { tries: 50, every: 150 });
    await H.sleep(1500);
    return { drawn, landed: !!landed };
  },

  /** Clear the party's lights, a kept fixture's state this walk leaves as it found it. */
  clearLights: async ({ fid }) => {
    const H = globalThis.__lf;
    await H.model.patchFormation(fid, (r) => { r.lights = []; });
    return true;
  },

  /** The cards this run's own client posted under the nonce that speak as or name the party. */
  cards: async ({ names }) => globalThis.__lf.cards.filter((c) => names.some((n) => c.alias === n || c.text.includes(n))),

  /** The party's token on the column scene, made from the party actor where none stands there, and adopted. */
  partyToken: async ({ fid, partyId, sceneId, x, y }) => {
    const H = globalThis.__lf;
    const scene = game.scenes.get(sceneId);
    let f = H.model.getFormation(fid);
    let token = f.tokenId ? scene.tokens.get(f.tokenId) : null;
    let made = null;
    if (!token) {
      const doc = await game.actors.get(partyId).getTokenDocument({ x, y, rotation: 270 });
      [token] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true, hidden: false }]);
      made = token.id;
      await H.poll(() => H.model.getFormation(fid).tokenId === token.id, { tries: 60, every: 200 });
    }
    const actor = game.actors.get(partyId);
    if (!actor.prototypeToken.sight?.enabled) await actor.update({ "prototypeToken.sight.enabled": true });
    if (!token.sight?.enabled) await token.update({ "sight.enabled": true });
    f = H.model.getFormation(fid);
    return { tokenId: f.tokenId, sceneId: f.sceneId, made };
  },

  /** The column's start shape: both lights lit and open, nobody deployed, no fight, the head at the corridor's west end. */
  columnStart: async ({ fid, torchId, lanternId, at }) => {
    const H = globalThis.__lf;
    const turns = (type) => H.light.lightFigures(type).turns;
    await H.model.patchFormation(fid, (r) => {
      r.frontage = 1;
      r.tokenShape = null;
      r.columnColor = null;
      r.combat = null;
      const last = r.clock?.lastPosition;
      r.clock = { turnsTotal: 0, turnsSinceRest: 0, encounterCounter: 0, carryFeet: 0, winded: false, paused: false, ...(last ? { lastPosition: last } : {}) };
      for (const m of r.members) { delete m.deployedTokenId; delete m.deployedSceneId; delete m.deployedStack; }
      r.lights = (r.lights ?? []).filter((l) => (l.bearerId === torchId && l.type === "torch") || (l.bearerId === lanternId && l.type === "lantern"));
      for (const l of r.lights) { l.lit = true; l.shielded = false; l.remaining = turns(l.type); }
    });
    for (const [bearer, type] of [[torchId, "torch"], [lanternId, "lantern"]]) {
      if (!H.model.getFormation(fid).lights.some((l) => l.bearerId === bearer && l.type === type)) {
        await H.F.addLight(H.model.getFormation(fid), type, bearer, { override: true });
      }
    }
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    await token.update({ hidden: false, width: 1, height: 1 }, { animate: false });
    await H.sleep(600);
    if (token.x !== at.x || token.y !== at.y) {
      await token.move({ x: at.x, y: at.y, action: "displace", snapped: false, explicit: true, checkpoint: true }, { method: "config", autoRotate: false, showRuler: false, constrainOptions: { ignoreWalls: true, ignoreCost: true } });
    }
    await H.sleep(900);
    await token.update({ rotation: 270 }, { animate: false });
    await H.sleep(1200);
    const after = H.model.getFormation(fid);
    return { lights: after.lights.map((l) => ({ type: l.type, lit: l.lit, shielded: !!l.shielded })), at: { x: token.x, y: token.y } };
  },

  formationState: async ({ fid }) => {
    const f = globalThis.__lf.model.getFormation(fid);
    return { lights: f.lights.map((l) => ({ id: l.id, type: l.type, bearer: l.bearerId, lit: l.lit, shielded: !!l.shielded })) };
  },

  openSheet: async ({ actorId, tab }) => {
    const H = globalThis.__lf;
    const app = game.actors.get(actorId).sheet;
    await app.render(true);
    await H.sleep(1000);
    if (tab) H.root(app)?.querySelector(`[data-action="tab"][data-tab="${tab}"]`)?.click();
    await H.sleep(400);
    return { rendered: !!H.root(app) };
  },
  closeSheet: async ({ actorId }) => {
    try { await game.actors.get(actorId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return true;
  },

  /** Which of the named bearers' column sources this seat holds, read until each is as wanted or the time runs out. */
  drawnUntil: async ({ fid, bearers, want, ms = 8000 }) => {
    const H = globalThis.__lf;
    const t0 = Date.now();
    const read = () => Object.fromEntries(Object.entries(bearers).map(([n, id]) => [n, !!canvas.effects.lightSources.get(H.cl.columnLightId(fid, id))]));
    while (Date.now() - t0 < ms && !Object.entries(want).every(([n, v]) => read()[n] === v)) await H.sleep(150);
    return { ...read(), waited: Date.now() - t0 };
  },

  /**
   * Arm this seat's latency recorder. Core's point-light source `add`, `remove`
   * and `destroy` are wrapped for the column's source ids, and the formations
   * setting's update hook, long tasks and timer gaps are logged, each with the
   * page's own clock (`timeOrigin + now`), which both seats share on one
   * machine. A second arm only empties the log.
   */
  latArm: async () => {
    const H = globalThis.__lf;
    const stamp = () => performance.timeOrigin + performance.now();
    H.stamp = stamp;
    if (!H.lat) {
      const lat = (H.lat = { log: [] });
      const prefix = "acks-extras.column.";
      const proto = foundry.canvas.sources.PointLightSource.prototype;
      for (const m of ["add", "remove", "destroy"]) {
        const orig = proto[m];
        proto[m] = function (...args) {
          if (String(this.sourceId).startsWith(prefix)) lat.log.push({ t: stamp(), ev: m, id: String(this.sourceId) });
          return orig.apply(this, args);
        };
      }
      Hooks.on("updateSetting", (s) => {
        if (s.key === "acks-extras.formations") lat.log.push({ t: stamp(), ev: "setting", vis: document.visibilityState, focus: document.hasFocus() });
      });
      try {
        new globalThis.PerformanceObserver((list) => {
          for (const e of list.getEntries()) lat.log.push({ t: performance.timeOrigin + e.startTime, ev: "longtask", ms: Math.round(e.duration) });
        }).observe({ type: "longtask" });
      } catch (_e) { /* not offered */ }
      try {
        new globalThis.PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const scripts = (e.scripts ?? []).slice(0, 3).map((s) => {
              let src = String(s.sourceURL || s.invoker || "");
              try { src = new URL(src, location.href).pathname; } catch (_e) { /* not a URL */ }
              return `${src.slice(-70)}:${Math.round(s.duration)}`;
            });
            lat.log.push({ t: performance.timeOrigin + e.startTime, ev: "frame", ms: Math.round(e.duration), scripts });
          }
        }).observe({ type: "long-animation-frame", buffered: false });
      } catch (_e) { /* not offered */ }
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        if (now - last > 400) lat.log.push({ t: stamp(), ev: "gap", ms: Math.round(now - last) });
        last = now;
      }, 100);
    }
    H.lat.log.length = 0;
    return true;
  },

  /** A press on a light's control on the open party sheet's Kit tab, with nothing timed: the setup's own. */
  kitPress: async ({ partyId, lightId, action }) => {
    const H = globalThis.__lf;
    const button = H.root(game.actors.get(partyId).sheet)?.querySelector(`.light[data-light-id="${lightId}"] [data-action="${action}"]`);
    if (!button) return { found: false };
    button.click();
    await H.sleep(1500);
    return { found: true };
  },

  /** A press on a light's control on the open party sheet's Kit tab, stamped on this page's clock and returning at once. */
  latClick: async ({ partyId, lightId, action }) => {
    const H = globalThis.__lf;
    const button = H.root(game.actors.get(partyId).sheet)?.querySelector(`.light[data-light-id="${lightId}"] [data-action="${action}"]`);
    if (!button) return { found: false };
    const t = H.stamp();
    H.lat.log.push({ t, ev: "click", action });
    button.click();
    return { found: true, t };
  },

  /** What this seat's recorder holds after `after`: the first formations-setting update and the first add or removal of the bearer's source, as ms from `after`. */
  latRead: async ({ after, bearer, want }) => {
    const H = globalThis.__lf;
    const log = H.lat.log.filter((e) => e.t >= after);
    const src = log.find((e) => String(e.id ?? "").endsWith(`.${bearer}`) && (want === "add" ? e.ev === "add" : e.ev === "remove" || e.ev === "destroy"));
    const set = log.find((e) => e.ev === "setting");
    const ms = (e) => (e ? Math.round((e.t - after) * 10) / 10 : null);
    const end = src?.t ?? Infinity;
    // A task already running when the broadcast arrived holds it back, so busy time is counted from before the click.
    const near = H.lat.log.filter((e) => e.t >= after - 4000 && e.t <= end);
    return {
      setting: ms(set),
      source: ms(src),
      age: Math.round((after - performance.timeOrigin) / 100) / 10,
      vis: set?.vis ?? null,
      focus: set?.focus ?? null,
      longtasks: near.filter((e) => e.ev === "longtask").length,
      busyMs: near.filter((e) => e.ev === "longtask").reduce((a, e) => a + e.ms, 0),
      gaps: near.filter((e) => e.ev === "gap").length,
      scripts: [...new Set(near.filter((e) => e.ev === "frame").flatMap((e) => e.scripts))].slice(0, 6),
      extra: log.filter((e) => ["add", "remove", "destroy"].includes(e.ev) && e !== src).slice(0, 6).map((e) => `${e.ev}@${Math.round(e.t - after)}`),
    };
  },

  boot: async () => globalThis.__lfBoot ?? null,
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

/** The recorder has to be in the page before the page loads, so it goes in over the seat's own CDP target, which then reloads the page. */
async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 500000;
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
  const seconds = await ready(api, label);
  ws.close();
  return seconds;
}

/** A read that may be repeated, tried again while a seat's page is too busy to answer inside the driver's timeout. */
async function patient(fn, tries = 5) {
  for (let n = 1; ; n++) {
    try { return await fn(); } catch (err) {
      if (n >= tries || !/timeout/i.test(String(err?.message))) throw err;
      await sleep(2000);
    }
  }
}

const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
};

const open = {};
const tracked = [];

const character = (name, items = [], ownership = undefined) => ({
  name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 } }, items, ...(ownership ? { ownership } : {}),
});
const gear = (name, qty) => ({ name, type: "item", system: { quantity: { value: qty, max: 0 } } });

/** The rounds and carried feet the clock should hold after a move, the way the clock spends it: from the carried feet, a round at a time. */
function expected(before, feet) {
  const roundFeet = before.turnFeet / before.rounds;
  let carry = (before.clock.carryFeet ?? 0) + feet;
  let rounds = 0;
  while (carry >= roundFeet) { carry -= roundFeet; rounds += 1; }
  return { roundFeet, rounds, carry: Math.round(carry * 10) / 10 };
}

/** One move billed and read: the module's own figures before, the displacement core allowed, the rounds and carry the clock holds after. */
async function billed(gm, fid, dx) {
  const before = await run(gm, P.snap, { fid });
  const moved = await run(gm, P.move, { fid, dx });
  const after = await run(gm, P.snap, { fid });
  const displacement = Math.hypot(after.src.x - before.src.x, after.src.y - before.src.y);
  const feet = (displacement / before.cell) * before.feetPerCell;
  const want = expected(before, feet);
  const got = {
    rounds: (after.clock.turnsTotal - before.clock.turnsTotal) * before.rounds + ((after.clock.roundsPartial ?? 0) - (before.clock.roundsPartial ?? 0)),
    carry: after.clock.carryFeet,
  };
  return { before, after, moved, displacement, want, got };
}

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  note("installed", [await run(gm, P.install, { nonce: NONCE }), await run(player, P.install, { nonce: NONCE })]);
  const census = { gm: await run(gm, P.census), player: await run(player, P.census) };
  check("the GM seat is the active GM and the player seat is a player", census.gm.activeGMIsSelf && census.player.role <= 2, { gm: census.gm.role, player: census.player.role });
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  if (census.player.role > 2) blocked("the player seat is not a player");
  for (const [k, c] of Object.entries(census)) check(`${k} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot?.errors);
  const ownLedger = fixtureLedger((expression) => gm.eval(expression), { own: "t0363" });

  /* ---------------------------------------------------------------- */
  section("Billing at the dark rate");
  const levels = await run(gm, P.levels, { mapId: "ax1.level2Map" });
  note("imported levels carrying the map id (read only)", levels.length);
  for (const l of levels) note("  level", { id: l.id, darkness: l.darkness, darknessLock: l.lock, walls: l.walls, tokenVision: l.tokenVision });
  if (levels.length) note("the premise (dark, 0.5 or more) holds on every such level", levels.every((l) => l.darkness != null && l.darkness >= 0.5));
  else note("the premise", "no imported level in this world: the darkness could not be read");

  const replica = await ownLedger.fixture("formation/t0361-delve", "Scene", {
    name: "QA T-0361 Delve (dark, walled)", active: false, navigation: false, width: 2100, height: 1400, padding: 0, tokenVision: true, backgroundColor: "#777777",
    grid: { type: 1, size: GRID, distance: 10, units: "ft" }, ownership: { default: 2 },
    environment: { darknessLevel: 1, darknessLock: true, globalLight: { enabled: false } },
    flags: { "acks-extras": { battlemap: { calibrated: true, distance: 10, autoScale: false, mapSystem: "delve", blockFeet: null } } },
  });
  const walker = { a: await gm.fixture("formation/t0361-a", "Actor", character("QA T-0361 Walker A")), b: await gm.fixture("formation/t0361-b", "Actor", character("QA T-0361 Walker B")) };
  const tParty = await gm.fixture("formation/t0361-party", "Actor", { name: "QA T-0361 Party", type: `${SCOPE}.party` });
  check("the replica scene is dark and its darkness is locked", (await gm.eval(`(() => { const s = game.scenes.get(${JSON.stringify(replica.id)}); return s.environment.darknessLevel >= 0.5 && s.environment.darknessLock; })()`)), replica.built ? "built" : "found");
  note("walls", await run(gm, P.walls, { sceneId: replica.id, segments: [WALL] }));
  const { fid: tFid, error: tError } = await run(gm, P.formationOf, { partyId: tParty.id });
  if (tError) throw new Error(tError);
  const seatedT = await run(gm, P.seat, { partyId: tParty.id, fid: tFid, actorIds: [walker.a.id, walker.b.id] });
  check("the replica party holds its two walkers", seatedT.members.length === 2, seatedT);
  check("the GM seat views the replica", (await run(gm, P.view, { sceneId: replica.id })).scene);
  const standing = await gm.eval(`game.scenes.get(${JSON.stringify(replica.id)}).tokens.filter((t) => t.actorId === ${JSON.stringify(tParty.id)}).length`);
  if (standing) blocked("a token of the replica party already stands on the replica: another run's, left for its owner");
  const tokenData = await run(gm, P.tokenData, { partyId: tParty.id, ...START });
  const tToken = await gm.create("Token", tokenData, { parent: replica.uuid });
  tracked.push(tToken.uuid);
  const adopted = await run(gm, P.adopt, { fid: tFid, tokenId: tToken.id, sceneId: replica.id });
  check("the party token stands on the replica, adopted by the record, in delve mode", adopted.adopted && adopted.sceneId === replica.id && adopted.mode === "delve", adopted);

  const dark = await billed(gm, tFid, EAST);
  note("dark: the module's reading before the move", { darkness: dark.before.sceneDarkness, sceneDark: dark.before.sceneDark, partyInDark: dark.before.partyInDark, effectiveSpeed: dark.before.effectiveSpeed, roundFeet: dark.want.roundFeet });
  note("dark: the move", { requestedPx: EAST, displacedPx: dark.displacement, feet: Math.round(dark.displacement / dark.before.cell * dark.before.feetPerCell * 100) / 100 });
  note("dark: expected and billed", { expected: { rounds: dark.want.rounds, carry: dark.want.carry }, billed: dark.got });
  check("dark: the scene reads dark and the party, with no light, is in the dark", dark.before.sceneDark && dark.before.partyInDark && !dark.before.lights.length, { darkness: dark.before.sceneDarkness, lights: dark.before.lights.length });
  check("dark: the wall constrained the move, so the clock was handed less than was asked", dark.moved.drawn && dark.displacement > 0 && dark.displacement < EAST, { drawn: dark.moved.drawn, requestedPx: EAST, displacedPx: dark.displacement });
  check("dark: the billed rounds and carried feet equal the displacement spent at the module's own round length", dark.moved.landed && dark.want.rounds > 0 && dark.got.rounds === dark.want.rounds && dark.got.carry === dark.want.carry, { expected: dark.want, billed: dark.got });

  const lit = await run(gm, P.light, { fid: tFid, bearerId: walker.a.id });
  check("the control party carries a lit torch", lit.lit, lit);
  const control = await billed(gm, tFid, -BACK);
  note("lit: the module's reading before the move", { partyInDark: control.before.partyInDark, effectiveSpeed: control.before.effectiveSpeed, roundFeet: control.want.roundFeet });
  note("lit: expected and billed", { expected: { rounds: control.want.rounds, carry: control.want.carry }, billed: control.got, displacedPx: control.displacement });
  check("lit: the party is not in the dark and its speed is above the dark rate", !control.before.partyInDark && control.before.effectiveSpeed > dark.before.effectiveSpeed, { dark: dark.before.effectiveSpeed, lit: control.before.effectiveSpeed });
  check("lit: the billed rounds and carried feet equal the displacement spent at the lit round length", control.moved.landed && control.want.rounds > 0 && control.got.rounds === control.want.rounds && control.got.carry === control.want.carry, { expected: control.want, billed: control.got });
  check("the dark rate bills more rounds per foot than the lit rate", dark.want.roundFeet < control.want.roundFeet, { dark: dark.want.roundFeet, lit: control.want.roundFeet });
  await run(gm, P.clearLights, { fid: tFid });
  for (const c of await run(gm, P.cards, { names: ["QA T-0361 Party"] })) tracked.push(gm.track(c.id, "ChatMessage"));

  /* ---------------------------------------------------------------- */
  section("A light change reaches both seats");
  const mine = { default: 0, [census.player.userId]: 3 };
  const cScene = await gm.fixture("formation/column-scene", "Scene", {
    name: "QA Column Corridor", active: false, navigation: false, width: 1200, height: 800, padding: 0, backgroundColor: "#6f6f6f",
    grid: { type: 1, size: GS, distance: 5, units: "ft" }, tokenVision: true, environment: { globalLight: { enabled: false } }, ownership: { default: 2 },
  });
  const cParty = await gm.fixture("formation/column-party", "Actor", { name: "QA Column Party", type: `${SCOPE}.party` });
  const lead = await gm.fixture("formation/column-lead", "Actor", character("QA Column Lead", [], mine));
  const torch = await gm.fixture("formation/column-torch", "Actor", character("QA Column Torch", [gear("Torch", 6)], mine));
  const lantern = await gm.fixture("formation/column-lantern", "Actor", character("QA Column Lantern", [gear("Lantern", 1), gear("Oil, flask", 4)], mine));
  check("the GM seat views the corridor", (await run(gm, P.view, { sceneId: cScene.id })).scene);
  note("walls", await run(gm, P.walls, { sceneId: cScene.id, segments: WALLS }));
  const { fid, error } = await run(gm, P.formationOf, { partyId: cParty.id });
  if (error) throw new Error(error);
  const seated = await run(gm, P.seat, { partyId: cParty.id, fid, actorIds: [lead.id, torch.id, lantern.id] });
  check("the column party holds lead, torch and lantern, in that order", JSON.stringify(seated.members) === JSON.stringify([lead.id, torch.id, lantern.id]), seated);
  const cpt = await run(gm, P.partyToken, { fid, partyId: cParty.id, sceneId: cScene.id, x: COLUMN_START.x, y: COLUMN_START.y });
  if (cpt.made) await gm.mark(`Scene.${cScene.id}.Token.${cpt.made}`, "formation/column-party-token");
  const bearers = { torch: torch.id, lantern: lantern.id };
  await run(gm, P.columnStart, { fid, torchId: torch.id, lanternId: lantern.id, at: COLUMN_START });
  check("the Player seat views the corridor", (await run(player, P.view, { sceneId: cScene.id })).scene);
  await run(gm, P.openSheet, { actorId: cParty.id, tab: "kit" });
  const fs0 = await run(gm, P.formationState, { fid });
  const lightIds = { torch: fs0.lights.find((l) => l.type === "torch")?.id, lantern: fs0.lights.find((l) => l.type === "lantern")?.id };
  check("the party holds a torch and a lantern", !!lightIds.torch && !!lightIds.lantern, lightIds);

  const STEPS = {
    shutter: { light: "lantern", action: "toggleShield", want: "remove" },
    open: { light: "lantern", action: "toggleShield", want: "add" },
    douse: { light: "torch", action: "toggleLight", want: "remove" },
    relight: { light: "torch", action: "toggleLight", want: "add" },
  };
  const rows = [];
  const timeouts = [];

  /** One press on the GM's Kit tab and the time each seat takes to show it, polled until both seats have it. */
  const press = async (name, ctx) => {
    const s = STEPS[name];
    const c = await run(gm, P.latClick, { partyId: cParty.id, lightId: lightIds[s.light], action: s.action });
    if (!c.found) throw new Error(`no ${s.action} control for the ${s.light} on the Kit tab`);
    const read = (api) => patient(() => run(api, P.latRead, { after: c.t, bearer: bearers[s.light], want: s.want }));
    const t0 = Date.now();
    let g;
    let p;
    for (;;) {
      g = await read(gm);
      p = await read(player);
      if ((g.source != null && p.source != null) || Date.now() - t0 > 15000) break;
      await sleep(250);
    }
    if (g.source == null || p.source == null) timeouts.push({ ...ctx, name, gm: g.source, player: p.source });
    const lag = g.source != null && p.source != null ? Math.round((p.source - g.source) * 10) / 10 : null;
    rows.push({ ...ctx, name, dir: s.want, gm: g.source, pl: p.source, lag, age: p.age, gmSet: g.setting, plSet: p.setting, vis: p.vis, focus: p.focus, tasks: p.longtasks, busy: p.busyMs, gaps: p.gaps, scripts: p.scripts, extra: p.extra });
    await sleep(1500);
  };

  /** Bring both lights to a shape by Kit presses, then wait until the GM's own canvas shows it. */
  const shape = async (want) => {
    const fs = await run(gm, P.formationState, { fid });
    const lanternNow = fs.lights.find((l) => l.type === "lantern");
    const torchNow = fs.lights.find((l) => l.type === "torch");
    const swap = [];
    if (!lanternNow.shielded !== want.lantern) swap.push(["lantern", "toggleShield"]);
    if (torchNow.lit !== want.torch) swap.push(["torch", "toggleLight"]);
    for (const [light, action] of swap) {
      const pressed = await run(gm, P.kitPress, { partyId: cParty.id, lightId: lightIds[light], action });
      if (!pressed.found) throw new Error(`no ${action} control for the ${light} on the Kit tab`);
    }
    return run(gm, P.drawnUntil, { fid, bearers, want: { torch: want.torch, lantern: want.lantern } });
  };

  /** Reload the Player seat, bring it to the scene, arm both recorders and confirm what the Player draws before the first press. */
  const reload = async (want) => {
    const s = await record(PORTS.player, "player", player);
    await patient(() => run(player, P.install, { nonce: NONCE }));
    await patient(() => run(player, P.view, { sceneId: cScene.id }));
    await sleep(1500);
    await run(gm, P.latArm);
    await patient(() => run(player, P.latArm));
    const drawn = await patient(() => run(player, P.drawnUntil, { fid, bearers, want: { torch: want.torch, lantern: want.lantern } }));
    return { seconds: s, drawn };
  };

  const ORDERS = {
    "cold, removal first": { start: { torch: true, lantern: true }, steps: ["shutter", "douse", "relight", "open"] },
    "cold, add first": { start: { torch: false, lantern: false }, steps: ["open", "relight", "shutter", "douse"] },
  };
  const REPS = 3;
  for (let rep = 1; rep <= REPS; rep++) {
    for (const [label, plan] of Object.entries(ORDERS)) {
      const g0 = await shape(plan.start);
      const r0 = await reload(plan.start);
      check(`${label}, rep ${rep}: both seats draw the starting shape before the first press`, g0.torch === plan.start.torch && g0.lantern === plan.start.lantern && r0.drawn.torch === plan.start.torch && r0.drawn.lantern === plan.start.lantern, { gm: g0, player: r0.drawn });
      for (let i = 0; i < plan.steps.length; i++) await press(plan.steps[i], { run: label, rep, pos: i + 1, cat: i === 0 ? "cold" : "later" });
    }
  }
  const SETTLE_MS = 30000;
  const settled = { torch: true, lantern: true };
  await shape(settled);
  const rs = await reload(settled);
  check("settled: both seats draw the starting shape before the first press", rs.drawn.torch && rs.drawn.lantern, rs.drawn);
  await sleep(SETTLE_MS);
  note("settled: waited after the Player's reload (s)", SETTLE_MS / 1000);
  for (let i = 0; i < 8; i++) await press(["shutter", "open", "douse", "relight"][i % 4], { run: "settled", rep: 1, pos: i + 1, cat: "warm" });

  // A seat's lag is how far the Player trails the GM's own landing of the same change: the write's round trip is in both.
  const cell = (cat, dir, field) => rows.filter((r) => r.cat === cat && r.dir === dir && r[field] != null).map((r) => r[field]);
  const table = {};
  for (const cat of ["cold", "later", "warm"]) {
    for (const dir of ["remove", "add"]) {
      table[`${cat}/${dir}`] = { n: rows.filter((r) => r.cat === cat && r.dir === dir).length, gmMedian: median(cell(cat, dir, "gm")), playerMedian: median(cell(cat, dir, "pl")), lagMedian: median(cell(cat, dir, "lag")), lag: cell(cat, dir, "lag") };
    }
  }
  console.log("\nlatency from the GM's click to the change landing on each seat (ms; one machine, one clock); lag is the Player's landing minus the GM's");
  for (const [k, v] of Object.entries(table)) console.log(`  ${k.padEnd(13)} n=${v.n}  gm median ${v.gmMedian}  player median ${v.playerMedian}  lag median ${v.lagMedian}  lags: ${JSON.stringify(v.lag)}`);
  for (const r of rows) console.log(`  row ${r.run} #${r.rep}.${r.pos} ${r.name} (Player page ${r.age} s old): gm ${r.gm} | player ${r.pl} | lag ${r.lag} | player setting ${r.plSet} | vis ${r.vis} focus ${r.focus} | longtasks ${r.tasks} (${r.busy} ms) gaps ${r.gaps} | frames ${JSON.stringify(r.scripts)} | other ${JSON.stringify(r.extra)}`);

  const lateRows = rows.filter((r) => r.lag != null && r.lag > LATE_MS);
  const lateOf = (pick) => lateRows.filter(pick).length;
  const ages = (list) => list.map((r) => r.age).sort((a, b) => a - b);
  note("late presses (ids by run, rep, position)", lateRows.map((r) => `${r.run}#${r.rep}.${r.pos}`));
  note("Player page age at each late press (s)", ages(lateRows));
  note("Player page age at each prompt press (s)", ages(rows.filter((r) => r.lag != null && r.lag <= LATE_MS)));
  let verdict = "mixed";
  if (!lateRows.length) verdict = "prompt: the module lands every change on the Player within the bound of the GM's; the earlier delay was the walk's measurement";
  else if (lateOf((r) => r.cat === "warm") === 0 && lateOf((r) => r.cat === "cold") === 6 && lateOf((r) => r.cat === "later") === 0) verdict = "first action after a reload: warm-up, not a direction effect";
  else if (lateOf((r) => r.cat === "warm") === 0 && lateOf((r) => r.dir === "remove") > 0 && lateOf((r) => r.dir === "add") > 0) verdict = "a busy window after the Player's reload, in both directions, gone once the page is settled: not a direction effect and not the first press";
  else if (lateOf((r) => r.dir === "add") === 0 && lateOf((r) => r.cat === "warm" && r.dir === "remove") > 0) verdict = "direction: removals late wherever they come, adds prompt";
  note("T-0402 verdict", verdict);
  note("late means the Player trails the GM by more than (ms)", LATE_MS);
  check("every shutter, open, douse and relight landed on both seats within 15 s", timeouts.length === 0 && rows.length === 2 * 4 * REPS + 8, { rows: rows.length, timeouts });
  check("the Player's delay has one cause: none, the first action after a reload, a busy window after it, or direction", verdict !== "mixed", table);
  check("settled, the Player seat lands every change within the bound of the GM's", rows.filter((r) => r.cat === "warm").length === 8 && rows.filter((r) => r.cat === "warm").every((r) => r.lag != null && r.lag <= LATE_MS), cell("warm", "remove", "lag").concat(cell("warm", "add", "lag")));

  await shape({ torch: true, lantern: true });
  await run(gm, P.closeSheet, { actorId: cParty.id });
  for (const c of await run(gm, P.cards, { names: ["QA Column Party"] })) tracked.push(gm.track(c.id, "ChatMessage"));

  section("errors after ready");
  for (const [k, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${k} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors?.slice(0, 5));
  }
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  const gm = open.gm;
  if (gm) {
    try { if (tracked.length) note("swept", await patient(() => gm.sweepTracked({ only: tracked.filter((u, i, a) => a.indexOf(u) === i) }))); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
