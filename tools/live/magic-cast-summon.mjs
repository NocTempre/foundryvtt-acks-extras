/**
 * Live walk, magic-cast-summon: casting a summoning spell places its creatures
 * (`scripts/magic/cast-summon.mjs`, a claimant on the cast seam). Walks
 * docs/magic/TESTING.md "Casting a summoning spell" on the GM and Player seats:
 * a boot recorder attached before the reload that sees `init`, `setup` and
 * `ready`; the Player's Magic tab Cast button opening the creature prompt for a
 * spell whose row names a creature the Player cannot open; the cast count
 * standing while the prompt and the placement are pending; two real clicks
 * placing two tokens that carry the spell's id and name and one cast id, with
 * the count up by exactly one, one card, and a caster record carrying that cast
 * id and the spell's imported duration; a right click and a closed prompt each
 * leaving the count where it was; a spell-less Summon… refused to the Player
 * and still working from the GM seat; a forged request (a creature the spell
 * does not name, with and without the shelf open) refused by the GM's client
 * with nothing made. Prints booleans and counts, never a name or an id.
 * Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `magic/summon-caster` (a character the Player owns, spells enabled),
 * `magic/summon-spell` (its summoning spell, one summon row naming
 * `magic/summon-creature` by uuid), `magic/summon-creature` (a monster nobody
 * but the GM can observe: the Player's seat resolves it and may not observe it), `magic/summon-other`
 * (another such monster the spell does not name), `magic/summon-open` (a monster
 * the Player may observe, which the spell does not name) and `magic/summon-scene`
 * (the field, which both seats view). The run's own documents (summoned tokens,
 * the creature's world copy where none stood, the cast cards and the caster
 * records) are tracked by uuid and swept alone. A paused world is unpaused for
 * the run and paused again in the finally.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const KEY = "magic-cast-summon-walk";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Runs before any of Foundry's scripts on the next document load: records warnings and errors from `init` on. */
const BOOT_RECORDER = `(() => {
  if (window.top !== window) return;
  const B = (window.__boot = { preFoundry: typeof globalThis.Hooks === "undefined" && typeof globalThis.game === "undefined", warn: [], error: [] });
  const text = (args) => args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300);
  for (const level of ["warn", "error"]) {
    const original = console[level];
    console[level] = (...args) => { B[level].push(text(args)); return original.apply(console, args); };
  }
  window.addEventListener("error", (e) => B.error.push("uncaught: " + String(e.message ?? "").slice(0, 200)));
})();`;

/** Where each placement is clicked, in scene pixels from the scene's corner (the field is 1400 by 900). */
const CELLS = { cast: [[450, 350], [650, 350]], cancel: [650, 550], bare: [700, 450] };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mc = globalThis.__mc ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.cards = (actorId) => [...game.messages].filter((m) => m.speaker?.actor === actorId).map((m) => m.id);
    H.seen = new Set();
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn;
      ui.notifications.warn = function (msg, ...rest) { H.warns.push(String(msg)); return H.warn.call(this, msg, ...rest); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      H.onRejection = (e) => H.uncaught.push("rejection: " + String(e.reason?.message ?? e.reason ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, claimant: typeof globalThis.acksExtras?.lib?.spellUse?.addClaimant === "function", castApi: typeof globalThis.acksExtras?.magic?.castSummon === "function", namingApi: typeof globalThis.acksExtras?.lib?.summons?.registerSummonNaming === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  /** What the recorder saw from `init` on. */
  boot: async () => {
    const b = window.__boot ?? null;
    return {
      recorded: !!b,
      preFoundry: !!b?.preFoundry,
      noRegisterError: b ? !b.error.some((e) => /summoning cast could not register|spell-use|summon policy|summon naming/u.test(e)) : null,
      noWrapWarning: b ? !b.warn.some((w) => /no Item#_useSpell to wrap/u.test(w)) : null,
      errors: b?.error.length ?? null,
    };
  },
  drain: async () => {
    const H = globalThis.__mc;
    const out = { errors: H.errors.slice(), warns: H.warns.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  /** View the field (no activation), the Tokens layer up, the scene's middle at the viewport's. */
  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (!scene) return false;
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1200));
    canvas.tokens.activate();
    return canvas.scene?.id === sceneId;
  },
  /** The caster's known shape: spells enabled, the count at 0, the spell's row naming the creature, no summons on the scene. */
  shape: async ({ casterId, spellId, ref, amount, sceneId }) => {
    const actor = game.actors.get(casterId);
    if (!actor.system.spells?.enabled) await actor.update({ "system.spells.enabled": true });
    const item = actor.items.get(spellId);
    await item.update({
      "system.cast": 0,
      "flags.acks-extras.spell": { schools: ["summoning"], effects: [{ type: "summon", ref, amount }], duration: { shape: "fixed", value: 2, unit: "hours" } },
    });
    const standing = [...game.scenes.get(sceneId).tokens].filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === actor.uuid).length;
    return { cast: item.system.cast, isSpell: item.type === "spell", enabled: !!actor.system.spells?.enabled, rows: item.getFlag("acks-extras", "spell")?.effects?.length ?? 0, standing };
  },
  /** On the seat that must not open the creature: whether it can resolve each ref, and whether it may observe the document. */
  probe: async ({ refs }) => {
    const out = [];
    for (const ref of refs) {
      let doc = null;
      try { doc = await fromUuid(ref); } catch { doc = null; }
      out.push({ resolves: !!doc, observes: !!doc?.testUserPermission(game.user, "OBSERVER") });
    }
    return out;
  },
  /** The placement's live state on this seat, after a click that should have placed. */
  diag: async () => {
    const H = globalThis.__mc;
    return { mouse: canvas.mousePosition ? { x: Math.round(canvas.mousePosition.x), y: Math.round(canvas.mousePosition.y) } : null, view: canvas.stage ? { x: Math.round(canvas.stage.pivot.x), y: Math.round(canvas.stage.pivot.y), s: canvas.stage.scale.x } : null, canvasReady: !!canvas.ready, paused: game.paused, previews: canvas.tokens?.preview?.children?.length ?? null, layerActive: !!canvas.tokens?.active, warns: H.warns.length, errors: H.errors.length, framed: [...foundry.applications.instances.values()].filter((a) => a.hasFrame && a.rendered).length };
  },
  /** Close every framed window, open the caster's sheet on its Magic tab and press the spell row's Cast button as a user does. Nothing is awaited: the prompt is the answer. */
  press: async ({ casterId, spellId }) => {
    const H = globalThis.__mc;
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    await actor.sheet.render(true);
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("magic", "primary");
    await H.sleep(500);
    const button = H.root(actor.sheet)?.querySelector(`[data-item-id='${spellId}'] [data-action='spellCast']`);
    if (!button) return { button: false };
    H.seen = new Set(H.cards(casterId));
    const before = item.system.cast;
    button.click();
    return { button: true, before };
  },
  /** The creature prompt, once it is up: its choices, its count, its title. */
  prompt: async ({ spellName }) => {
    const H = globalThis.__mc;
    const form = await H.poll(() => [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count), { tries: 60, every: 200 });
    if (!form) return { prompt: false };
    const options = [...form.elements.source.options];
    return {
      prompt: true,
      values: options.map((o) => o.value),
      labelled: options.every((o) => o.textContent.trim().length > 0),
      count: form.elements.count.value,
      titled: form.closest(".application")?.querySelector(".window-title")?.textContent.trim() === spellName,
      spellField: !!form.elements.spell,
    };
  },
  /** Answer the prompt (count, then Place on the map), then clear every framed window off the map. */
  answer: async ({ count, source }) => {
    const H = globalThis.__mc;
    const form = [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count);
    if (!form) return { prompt: false };
    if (source && [...form.elements.source.options].some((o) => o.value === source)) form.elements.source.value = source;
    if (count) form.elements.count.value = String(count);
    const ok = form.querySelector('button[data-action="ok"]') ?? form.closest(".application")?.querySelector('button[data-action="ok"]');
    ok?.click();
    await H.sleep(500);
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    await H.sleep(500);
    return { prompt: true, pressed: !!ok };
  },
  /** Close the prompt window itself, as a user dismisses it. */
  dismissPrompt: async () => {
    const H = globalThis.__mc;
    const form = [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count);
    const app = form ? foundry.applications.instances.get(form.closest(".application")?.id) : null;
    if (!app) return false;
    await app.close({ animate: false });
    await H.sleep(800);
    return true;
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* a notice left standing is only chrome over the map */ }
    return true;
  },
  /** One client point per entry of `cells`, found by scanning the viewport; each says whether the bare canvas lies under it and well inside the scene. */
  pointsFor: async ({ cells, avoid = [] }) => {
    const r = canvas.dimensions.sceneRect;
    // Core clamps the zoom, and an animation can still be moving the view, so the pan is repeated until two reads half a second apart agree on the view.
    const snap = () => `${canvas.stage.scale.x.toFixed(3)}:${Math.round(canvas.stage.pivot.x)}:${Math.round(canvas.stage.pivot.y)}`;
    let last = "";
    for (let n = 0; n < 12; n++) {
      canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: 0.5 });
      await new Promise((res) => setTimeout(res, 500));
      const now = snap();
      if (now === last) break;
      last = now;
    }
    // The view core settles on is not the one asked for, so the points are not computed from scene cells: the viewport is scanned for spots where the bare canvas lies under the pointer and the spot maps well inside the scene, and one point is chosen per cell asked for, each at least a grid cell and a half from the others and from `avoid`.
    const W = window.innerWidth;
    const H = window.innerHeight;
    const found = [];
    for (let y = 20; y < H - 20; y += 30) {
      for (let x = 20; x < W - 20; x += 30) {
        if (document.elementFromPoint(x, y) !== canvas.app.view) continue;
        const back = canvas.canvasCoordinatesFromClient({ x, y });
        if (back.x >= r.x + 100 && back.y >= r.y + 100 && back.x <= r.x + r.width - 100 && back.y <= r.y + r.height - 100) found.push({ x, y, back });
      }
    }
    const view = [W, H, window.devicePixelRatio, Number(canvas.stage.scale.x.toFixed(3)), found.length];
    if (!found.length) return cells.map(() => ({ x: 0, y: 0, onCanvas: false, cover: "no bare spot inside the scene", view, scene: null }));
    const cx = found.reduce((a, p) => a + p.x, 0) / found.length;
    const cy = found.reduce((a, p) => a + p.y, 0) / found.length;
    found.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const apart = Math.max(120, canvas.dimensions.size * canvas.stage.scale.x * 1.5);
    const out = [];
    for (const _cell of cells) {
      const pick = found.find((p) => [...out, ...avoid].every((o) => Math.hypot(p.x - o.x, p.y - o.y) >= apart));
      out.push(pick ? { x: pick.x, y: pick.y, onCanvas: true, cover: "", view, scene: [Math.round(pick.back.x - r.x), Math.round(pick.back.y - r.y)] } : { x: 0, y: 0, onCanvas: false, cover: "no second spot", view, scene: null });
    }
    return out;
  },
  worldTime: async () => game.time.worldTime,
  /** The cast count and the cards made since the last press. */
  state: async ({ casterId, spellId }) => {
    const H = globalThis.__mc;
    const item = game.actors.get(casterId).items.get(spellId);
    return { cast: item.system.cast, cards: H.cards(casterId).filter((id) => !H.seen.has(id)) };
  },
  summonTokens: async ({ sceneId, summonerUuid }) =>
    [...game.scenes.get(sceneId).tokens]
      .filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === summonerUuid)
      .map((t) => ({ uuid: t.uuid, record: t.actor.getFlag("acks-extras", "summon") ?? null, owner: t.isOwner && !!t.actor?.isOwner, unlinked: t.actorLink === false })),
  /** The world copies of a source: their uuid, and whether any player holds a level on them. */
  copiesOf: async ({ sourceUuid }) =>
    game.actors
      .filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid)
      .map((a) => ({ uuid: a.uuid, noDefault: (a.ownership?.default ?? 0) === 0, playerLevels: Object.entries(a.ownership ?? {}).filter(([id, level]) => id !== "default" && level > 0 && !game.users.get(id)?.isGM).length })),
  /** The caster records one cast left on the actor. */
  recordOf: async ({ casterId, castId, spellUuid }) => {
    const actor = game.actors.get(casterId);
    return actor.effects
      .filter((e) => e.getFlag("acks-extras", "spellEffect")?.castId === castId)
      .map((e) => {
        const flag = e.getFlag("acks-extras", "spellEffect");
        return { uuid: e.uuid, role: flag.role, casterOk: flag.casterUuid === actor.uuid, spellOk: flag.spellUuid === spellUuid && e.origin === spellUuid, value: e.duration?.value ?? null, units: e.duration?.units ?? null };
      });
  },
  /** Every caster record on the actor, as cast ids. */
  recordIds: async ({ casterId }) => game.actors.get(casterId).effects.map((e) => e.getFlag("acks-extras", "spellEffect")?.castId).filter(Boolean),
  /** The API's own answer to a spell-less placement on a creature this seat can read. */
  bareApi: async ({ casterId, sourceUuid }) => {
    const r = await acksExtras.lib.summons.placeSummons(game.actors.get(casterId), { sourceUuid, count: 1 });
    return { ok: r?.ok === true, reason: r?.reason ?? null };
  },
  /** Summon… through its prompt: refused outright for a seat that may not summon bare. */
  bareRefused: async ({ casterId }) => {
    const H = globalThis.__mc;
    H.warns.length = 0;
    const { promptSummon } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    const r = await promptSummon(game.actors.get(casterId));
    return { ok: r?.ok === true, reason: r?.reason ?? null, warned: H.warns.length };
  },
  /** Start Summon… on this seat; its result lands on the page when the click places. */
  startBare: async ({ casterId }) => {
    const H = globalThis.__mc;
    H.bare = null;
    const { promptSummon } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    promptSummon(game.actors.get(casterId)).then((r) => { H.bare = r ?? { ok: false, reason: "closed" }; });
    return true;
  },
  bareResult: async () => {
    const H = globalThis.__mc;
    return (await H.poll(() => H.bare, { tries: 50, every: 200 })) ?? null;
  },
  firstCreature: async () => {
    const { summonShelves } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    return summonShelves()[0]?.entries?.[0]?.uuid ?? null;
  },
  /** A request on the relay as a client that skipped the seat's own check would send it. */
  forge: async ({ summonerUuid, sourceUuid, sceneId, spellId, count }) => {
    const { executeAsGM } = await import("/modules/acks-extras/scripts/lib/sockets.mjs");
    const positions = Array.from({ length: count }, (_, i) => ({ x: 300 + 100 * i, y: 300 }));
    const r = await executeAsGM("summonRelay", { op: "place", summonerUuid, sourceUuid, sceneId, positions, count, spellId, castId: "forge001" });
    return { ok: r?.ok === true, reason: r?.reason ?? null, made: r?.tokenUuids?.length ?? 0 };
  },
  /** The same request through the seat's API, which checks first. */
  placeApi: async ({ casterId, sourceUuid, spellId, count }) => {
    const r = await acksExtras.lib.summons.placeSummons(game.actors.get(casterId), { sourceUuid, count, spellId });
    return { ok: r?.ok === true, reason: r?.reason ?? null };
  },
  restore: async () => {
    const H = globalThis.__mc;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
    window.removeEventListener("error", H.onError);
    window.removeEventListener("unhandledrejection", H.onRejection);
    H.patched = false;
    return "restored";
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, { seconds = 240, fresh = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.summons && !!globalThis.acksExtras?.magic && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * Attach a second DevTools session to a seat's page, register the boot
 * recorder for the next document, and reload: the driver's own session attaches
 * after `ready`, so a recorder it injects would miss `init`, `setup` and `ready`.
 */
async function reloadWithRecorder(api, port, label) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const cdp = new Cdp(ws);
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page" && t.url.includes("/game"));
    if (!page) throw new Error("no /game page to reload");
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT_RECORDER }, sessionId);
    await api.eval("window.__preReload = true; 0");
    await cdp.send("Page.reload", {}, sessionId);
    const seconds = await ready(api, `${label} after reload`, { fresh: true });
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId).catch(() => {});
    return seconds;
  } finally {
    try { ws.close(); } catch {}
  }
}

/** A CDP session on a seat's page, for real mouse input. */
async function pageSession(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 700000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close() };
}
/** Bring a seat's page to the front, so its canvas lays out and renders (a hidden page does neither). */
async function frontSeat(port) {
  const s = await pageSession(port);
  await s.send("Page.bringToFront");
  s.close();
  await sleep(1200);
}
/** A real click on a seat's page: the pointer moves there first, so core's preview follows it. */
async function clickAt(port, { x, y }, button = "left") {
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(250);
  await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
  await sleep(80);
  await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
  s.close();
  await sleep(700);
}

let gm = null;
let player = null;
let wasPaused = false;
/** The uuids of what this run made: the only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 900_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Poll a page read until `fn(result)` is true or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 60, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm, PORTS.gm, "gm"));
  note("player reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(player, PORTS.player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  check("the cast seam, the summons naming and the summoning cast are on both seats' apis", installed.claimant && installed.castApi && installed.namingApi && seated.claimant && seated.castApi && seated.namingApi);
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const boot = await run(seat, P.boot);
    check(`${label}: the recorder ran before Foundry's scripts and saw the load, with no cast-summon or seam error and no wrap warning`, boot.recorded && boot.preFoundry && boot.noRegisterError === true && boot.noWrapWarning === true, { errors: boot.errors });
  }
  // A paused world refuses a player's summons; the run unpauses it and the finally pauses it again.
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const scene = await gm.fixture("magic/summon-scene", "Scene", {
    name: "QA Cast Summon Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 },
  });
  const creature = await gm.fixture("magic/summon-creature", "Actor", { name: "QA Cast Summon Creature", type: "monster", ownership: { default: 0 } });
  const other = await gm.fixture("magic/summon-other", "Actor", { name: "QA Cast Summon Other", type: "monster", ownership: { default: 0 } });
  const open = await gm.fixture("magic/summon-open", "Actor", { name: "QA Cast Summon Open", type: "monster", ownership: { default: 2 } });
  const caster = await gm.fixture("magic/summon-caster", "Actor", {
    name: "QA Cast Summon Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [playerId]: 3 },
  });
  const spellName = "QA Cast Summon Spell";
  const spell = await gm.fixture("magic/summon-spell", "Item", { name: spellName, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const casterId = idOf(caster);
  const spellId = idOf(spell);
  const sceneId = idOf(scene);
  const casterUuid = `Actor.${casterId}`;
  const spellUuid = `${casterUuid}.Item.${spellId}`;
  const creatureUuid = `Actor.${idOf(creature)}`;
  const otherUuid = `Actor.${idOf(other)}`;
  const openUuid = `Actor.${idOf(open)}`;
  const shaped = await run(gm, P.shape, { casterId, spellId, ref: creatureUuid, amount: 2, sceneId });
  check("shape: the caster has spells enabled and the spell's count at 0, with one summon row and no summons standing", shaped.enabled && shaped.isSpell && shaped.cast === 0 && shaped.rows === 1 && shaped.standing === 0, shaped);
  if (shaped.standing) throw new Error("leftover summons on the field from a run that did not sweep");
  const recordsBefore = new Set(await run(gm, P.recordIds, { casterId }));
  const creatureCopiesBefore = await run(gm, P.copiesOf, { sourceUuid: creatureUuid });
  note("world copies of the named creature before the run", creatureCopiesBefore.length);
  await sleep(1500);
  check("the Player seat views the field without activating it", await run(player, P.view, { sceneId }));
  check("the GM seat views the field", await run(gm, P.view, { sceneId }));
  const probe = await run(player, P.probe, { refs: [creatureUuid, otherUuid, openUuid] });
  // A world actor reaches the Player's client whatever its ownership, so the seat resolves it; what it may not do is observe it, which is what the shelf-readable check reads.
  check("the Player seat may not observe the named creature or the unnamed one on a closed shelf, and may observe the open one", !probe[0].observes && !probe[1].observes && probe[2].observes, probe.map((p) => ({ resolves: p.resolves, observes: p.observes })));
  const tokens = (api) => run(api, P.summonTokens, { sceneId, summonerUuid: casterUuid });
  await run(player, P.drain);
  await run(gm, P.drain);

  section("1. the Cast button opens the prompt; nothing is spent while it and the placement are pending");
  const pressed = await run(player, P.press, { casterId, spellId });
  check("the Magic tab's Cast button exists on the spell row", pressed.button, { before: pressed.before });
  if (!pressed.button) throw new Error("no Cast button on the Player's Magic tab");
  const prompt = await run(player, P.prompt, { spellName });
  check("the creature prompt opens, titled for the spell, with the spell's one row as its one choice", prompt.prompt && prompt.titled && prompt.values.length === 1 && prompt.values[0] === creatureUuid, { choices: prompt.values?.length });
  check("the choice is labelled although the Player cannot open the creature, the count opens on the row's amount, and the free spell field is not offered", prompt.labelled && prompt.count === "2" && !prompt.spellField, { count: prompt.count, spellField: prompt.spellField });
  const mid = await run(player, P.state, { casterId, spellId });
  check("1: with the prompt up the cast count is unchanged and no card has posted", mid.cast === pressed.before && mid.cards.length === 0, { cast: mid.cast, cards: mid.cards.length });
  const answered = await run(player, P.answer, { count: 2 });
  check("Place on the map is pressed and the windows are cleared off the map", answered.prompt && answered.pressed);
  const points = await run(player, P.pointsFor, { cells: CELLS.cast });
  check("every click point lies on the bare canvas", points.every((p) => p.onCanvas), points.map((p) => ({ onCanvas: p.onCanvas, nudged: p.nudged, cover: p.cover, view: p.view, scene: p.scene })));
  const worldTime = await run(player, P.worldTime);
  const pending = await run(player, P.state, { casterId, spellId });
  check("1: with the previews up and nothing clicked the count is still unchanged", pending.cast === pressed.before && pending.cards.length === 0);
  note("2: the Player seat's placement state before the clicks", await run(player, P.diag));
  // Each point is read again just before its own click, the view panned back first, so a view that moved since the first read cannot send a click off the scene.
  const clicked = [];
  for (const cell of CELLS.cast) {
    const [p] = await run(player, P.pointsFor, { cells: [cell], avoid: clicked });
    if (!p.onCanvas) throw new Error("a click point left the bare canvas before its click");
    await clickAt(PORTS.player, p);
    clicked.push(p);
  }
  note("2: the Player seat's placement state after the clicks", await run(player, P.diag));

  section("2. two clicks place two tokens, and the cast is spent once");
  let placed = [];
  for (let n = 0; n < 40 && placed.length < 2; n++) { placed = await tokens(gm); if (placed.length < 2) await sleep(300); }
  for (const t of placed) await track(t.uuid, "Token");
  check("2: two left clicks place two tokens", placed.length === 2, { n: placed.length });
  if (placed.length !== 2) {
    note("2: the Player seat's recorder after the clicks", await run(player, P.drain));
    note("2: the GM seat's recorder after the clicks", await run(gm, P.drain));
  }
  if (placed.length !== 2) throw new Error("the cast placed no creatures; every later step reads its tokens");
  const casts = new Set(placed.map((t) => t.record?.castId));
  check("2: one cast id across the two, naming the spell by id and by name, with the world time", casts.size === 1 && !casts.has(undefined) && placed.every((t) => t.record?.spellId === spellId && t.record?.spellName === spellName && t.record?.at >= worldTime), { casts: casts.size });
  check("2: each token is unlinked and the Player owns it and its actor", placed.every((t) => t.owner && t.unlinked));
  const castId = [...casts][0];
  const after = await until(player, P.state, { casterId, spellId }, (s) => s.cast > pressed.before && s.cards.length >= 1, { tries: 60, every: 200 });
  await sleep(900);
  const settled = await run(player, P.state, { casterId, spellId });
  for (const id of settled.cards) await track(`ChatMessage.${id}`, "ChatMessage");
  check("2: the cast count rose by exactly 1 and one card posted", settled.cast === pressed.before + 1 && settled.cards.length === 1 && after.cast === pressed.before + 1, { before: pressed.before, after: settled.cast, cards: settled.cards.length });
  const record = await until(gm, P.recordOf, { casterId, castId, spellUuid }, (r) => r.length >= 1, { tries: 30, every: 250 });
  for (const r of record) await track(r.uuid, "ActiveEffect");
  check("2: one caster record carries the summons' cast id, the spell and the caster, with the spell's imported duration", record.length === 1 && record[0].role === "caster" && record[0].casterOk && record[0].spellOk && record[0].value === 2 && record[0].units === "hours", { n: record.length, role: record[0]?.role, value: record[0]?.value, units: record[0]?.units });
  const copies = await run(gm, P.copiesOf, { sourceUuid: creatureUuid });
  if (!creatureCopiesBefore.length) for (const c of copies) await track(c.uuid, "Actor");
  check("2: the GM's client made the one world copy of a creature the Player could not open, owned by no player", copies.length === 1 && copies[0].noDefault && copies[0].playerLevels === 0, { copies: copies.length });
  const d1 = await run(player, P.drain);
  check("2: no console error, uncaught error or warning on the Player seat", !d1.errors.length && !d1.uncaught.length && !d1.warns.length, { errors: d1.errors.length, uncaught: d1.uncaught.length, warns: d1.warns.length });
  await run(player, P.clearWindows);

  section("3. a right click and a closed prompt each leave the count where it was");
  const baseCast = settled.cast;
  const press3 = await run(player, P.press, { casterId, spellId });
  check("3: the Cast button is pressed again", press3.button && press3.before === baseCast);
  check("3: the prompt opens", (await run(player, P.prompt, { spellName })).prompt);
  await run(player, P.answer, { count: 1 });
  const [cancelAt] = await run(player, P.pointsFor, { cells: [CELLS.cancel] });
  await clickAt(PORTS.player, cancelAt, "right");
  await sleep(2500);
  const cancelled = await run(player, P.state, { casterId, spellId });
  const afterCancel = await tokens(gm);
  const dc = await run(player, P.drain);
  check("3: a right click makes no token, leaves the count, posts no card and shows no warning", cancelled.cast === baseCast && cancelled.cards.length === 0 && afterCancel.length === 2 && !dc.warns.length && !dc.errors.length, { cast: cancelled.cast, cards: cancelled.cards.length, tokens: afterCancel.length, warns: dc.warns.length, errors: dc.errors.length });
  await run(player, P.clearWindows);
  const press3b = await run(player, P.press, { casterId, spellId });
  check("3: the Cast button is pressed a third time", press3b.button);
  check("3: the prompt opens again", (await run(player, P.prompt, { spellName })).prompt);
  check("3: the prompt is closed without placing", await run(player, P.dismissPrompt));
  await sleep(2500);
  const closed = await run(player, P.state, { casterId, spellId });
  check("3: a closed prompt makes no token, leaves the count and posts no card", closed.cast === baseCast && closed.cards.length === 0 && (await tokens(gm)).length === 2, { cast: closed.cast, cards: closed.cards.length });
  const idsNow = await run(gm, P.recordIds, { casterId });
  check("3: neither wrote a caster record", idsNow.filter((id) => !recordsBefore.has(id)).length === 1);

  section("4. what the spell does not name, and a spell-less Summon…");
  const forgedOther = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: otherUuid, sceneId, spellId, count: 1 });
  check("4: a forged relay request for an unnamed creature on a shelf the Player cannot open is refused unreadable and makes nothing", !forgedOther.ok && forgedOther.reason === "unreadable" && forgedOther.made === 0, forgedOther);
  const forgedOpen = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: openUuid, sceneId, spellId, count: 1 });
  check("4: a forged relay request for an unnamed creature the Player may read is refused notNamed and makes nothing", !forgedOpen.ok && forgedOpen.reason === "notNamed" && forgedOpen.made === 0, forgedOpen);
  const forgedCount = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: creatureUuid, sceneId, spellId, count: 3 });
  check("4: a forged relay request for the named creature over the row's amount is refused badCount", !forgedCount.ok && forgedCount.reason === "badCount" && forgedCount.made === 0, forgedCount);
  const forgedBare = await run(player, P.forge, { summonerUuid: casterUuid, sourceUuid: openUuid, sceneId, spellId: "", count: 1 });
  check("4: a forged spell-less relay request from the Player is refused spellRequired", !forgedBare.ok && forgedBare.reason === "spellRequired" && forgedBare.made === 0, forgedBare);
  const apiOther = await run(player, P.placeApi, { casterId, sourceUuid: otherUuid, spellId, count: 1 });
  check("4: the seat's own placement of a creature the spell does not name stops before any click, unreadable", !apiOther.ok && apiOther.reason === "unreadable", apiOther);
  const apiBare = await run(player, P.bareApi, { casterId, sourceUuid: openUuid });
  check("4: the Player's spell-less placement is refused spellRequired by the seat", !apiBare.ok && apiBare.reason === "spellRequired", apiBare);
  const promptBare = await run(player, P.bareRefused, { casterId });
  check("4: the Player's Summon… is refused spellRequired with a warning and no prompt", !promptBare.ok && promptBare.reason === "spellRequired" && promptBare.warned === 1, { warned: promptBare.warned });
  check("4: nothing beyond the two tokens of step 2 stands", (await tokens(gm)).length === 2);

  section("5. the GM seat's Summon… still places a creature with no spell");
  const shelfCreature = await run(gm, P.firstCreature);
  check("5: the GM seat can open a monster compendium", !!shelfCreature);
  if (shelfCreature) {
    const shelfCopiesBefore = await run(gm, P.copiesOf, { sourceUuid: shelfCreature });
    await run(gm, P.clearWindows);
    await run(gm, P.startBare, { casterId });
    const gmPrompt = await run(gm, P.answer, { count: 1, source: shelfCreature });
    check("5: the prompt opens for the GM seat and Place on the map is pressed", gmPrompt.prompt && gmPrompt.pressed);
    await frontSeat(PORTS.gm);
    const [bareAt] = await run(gm, P.pointsFor, { cells: [CELLS.bare] });
    check("5: the click point lies on the bare canvas", bareAt.onCanvas, { onCanvas: bareAt.onCanvas, cover: bareAt.cover, view: bareAt.view, scene: bareAt.scene });
    note("5: the GM seat's placement state before the click", await run(gm, P.diag));
    await clickAt(PORTS.gm, bareAt);
    const bare = await run(gm, P.bareResult);
    note("5: the GM seat's placement state after the click", await run(gm, P.diag));
    for (const uuid of bare?.tokenUuids ?? []) await track(uuid, "Token");
    check("5: the click places one creature, accepted by the relay with no spell", bare?.ok === true && bare.tokenUuids?.length === 1, { ok: bare?.ok ?? null, n: bare?.tokenUuids?.length ?? 0 });
    const gmTokens = (await tokens(gm)).filter((t) => !placed.some((p) => p.uuid === t.uuid));
    check("5: its record names the summoner and carries no spell", gmTokens.length === 1 && !gmTokens[0].record?.spellId && !gmTokens[0].record?.spellName, { n: gmTokens.length });
    const shelfCopies = await run(gm, P.copiesOf, { sourceUuid: shelfCreature });
    if (!shelfCopiesBefore.length) for (const c of shelfCopies) await track(c.uuid, "Actor");
    check("5: the GM's bare summoning cast nothing: the spell's count is unchanged", (await run(gm, P.state, { casterId, spellId })).cast === settled.cast);
  }

  const pEnd = await run(player, P.drain);
  const gEnd = await run(gm, P.drain);
  check("no console error or uncaught error on the Player seat over the rest of the walk", !pEnd.errors.length && !pEnd.uncaught.length, { errors: pEnd.errors.length, uncaught: pEnd.uncaught.length });
  check("no console error or uncaught error on the GM seat over the walk", !gEnd.errors.length && !gEnd.uncaught.length, { errors: gEnd.errors.length, uncaught: gEnd.uncaught.length });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's own tokens, cards, records and copies go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  if (gm && wasPaused) {
    try { note("paused again", await run(gm, P.pause, { paused: true })); } catch (err) { console.error("pause restore:", err?.message ?? err); }
  }
  console.log("fixtures kept: magic/summon-caster, magic/summon-spell, magic/summon-creature, magic/summon-other, magic/summon-open, magic/summon-scene");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
