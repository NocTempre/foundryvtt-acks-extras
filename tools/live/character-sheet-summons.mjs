/**
 * Live walk, character-sheet-summons: a player summons through the character
 * sheet. Walks docs/character-sheet/TESTING.md "Summons from a Player seat" on
 * the GM and Player seats: a boot recorder attached before the reload that sees
 * `init`, `setup` and `ready`; the party cell offering Cast for each summoning
 * spell and no spell-less Summon… to the Player; Cast placing the named
 * creature by two real clicks, after which the cell offers that spell's
 * Dismiss with its count and no Cast; the Magic tab's standing count and its
 * Dismiss; a second spell's cast from an open shelf adding Dismiss all; the
 * world clock moved past the first cast's duration posting one whispered card,
 * once, to the caster's owner and the GM, whose Dismiss on the Player seat
 * removes that cast and nothing else; the Magic tab's Dismiss removing the
 * other; a creature bound by hand kept by Release alone; a character the
 * Player does not own offering neither Cast nor Summon…; the GM seat offered
 * Summon…. Prints booleans and counts, never a name or an id. Machine values
 * arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them): `summons/scene`,
 * `summons/summoner` (a character the Player owns) with its token
 * `summons/summoner-token`, its two summoning spells `summons/spell-named` (one
 * row naming `summons/spike-source` by uuid, a short invented duration) and
 * `summons/spell-open` (one row with no creature, no duration),
 * `summons/stranger` (a character the Player only observes),
 * `summons/spike-source` (a monster only the GM may observe) and its unlinked
 * token `summons/bindable`, owned by the Player through its delta. The run's
 * own documents (summoned tokens, the creatures' world copies where none stood,
 * the cast cards, the cast-ended card and the caster records) are tracked by
 * uuid and swept alone. The world clock moves forward by the seconds printed
 * and is not moved back. A paused world is unpaused for the run and paused
 * again in the finally.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

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

/** The named spell's duration: an invented minute, so one short step of the clock runs it out. */
const NAMED_DURATION = { shape: "fixed", value: 1, unit: "minutes" };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__cs = globalThis.__cs ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
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
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, castApi: typeof globalThis.acksExtras?.magic?.castSummon === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  boot: async () => {
    const b = window.__boot ?? null;
    return { recorded: !!b, preFoundry: !!b?.preFoundry, castExpiryError: b ? b.error.some((e) => /cast-end watch could not register|cast-end sweep failed/u.test(e)) : null, errors: b?.error.length ?? null };
  },
  drain: async () => {
    const H = globalThis.__cs;
    const out = { errors: H.errors.slice(), warns: H.warns.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    H.uncaught.length = 0;
    return out;
  },
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
  /** The known shape: spells enabled, both spells summoning with their rows, the counts at 0. */
  shape: async ({ actorId, namedId, openId, namedRef, duration }) => {
    const actor = game.actors.get(actorId);
    if (!actor.system.spells?.enabled) await actor.update({ "system.spells.enabled": true });
    await actor.items.get(namedId).update({ "system.cast": 0, "flags.acks-extras.spell": { schools: ["summoning"], effects: [{ type: "summon", ref: namedRef, amount: 2 }], duration } });
    await actor.items.get(openId).update({ "system.cast": 0, "flags.acks-extras.spell": { schools: ["summoning"], effects: [{ type: "summon", amount: 1 }] } });
    const { isSummonSpell } = await import("/modules/acks-extras/scripts/magic/summon-spell.mjs");
    return { enabled: !!actor.system.spells?.enabled, named: isSummonSpell(actor.items.get(namedId)), open: isSummonSpell(actor.items.get(openId)) };
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    return true;
  },
  /** Open the actor's sheet and its party cell; the menu's entries, as their labels. */
  menu: async ({ actorId }) => {
    const H = globalThis.__cs;
    const sheet = game.actors.get(actorId)?.sheet;
    if (!sheet) return { sheet: false, cell: false, items: [] };
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); await H.sleep(600); }
    document.querySelectorAll(".acks-extras-frame__menu").forEach((m) => m.remove());
    const button = H.root(sheet)?.querySelector('[data-action="partyMenu"]');
    if (!button) return { sheet: true, cell: false, items: [] };
    button.click();
    await H.sleep(600);
    return { sheet: true, cell: true, items: [...document.querySelectorAll(".acks-extras-frame__menu-item")].map((b) => b.textContent.trim()) };
  },
  closeMenu: async () => { document.querySelectorAll(".acks-extras-frame__menu").forEach((m) => m.remove()); return true; },
  pick: async ({ label }) => {
    const H = globalThis.__cs;
    const b = [...document.querySelectorAll(".acks-extras-frame__menu-item")].find((x) => x.textContent.trim() === label);
    if (!b) return false;
    b.click();
    await H.sleep(900);
    return true;
  },
  /** The creature prompt, once it is up: its choices and its count. */
  prompt: async () => {
    const H = globalThis.__cs;
    const form = await H.poll(() => [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count), { tries: 60, every: 200 });
    if (!form) return { prompt: false };
    return { prompt: true, values: [...form.elements.source.options].map((o) => o.value), count: form.elements.count.value };
  },
  /** Answer the prompt (count, then Place on the map), then clear every framed window off the map. */
  answer: async ({ count }) => {
    const H = globalThis.__cs;
    const form = [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count);
    if (!form) return { prompt: false };
    if (count) form.elements.count.value = String(count);
    const ok = form.querySelector('button[data-action="ok"]') ?? form.closest(".application")?.querySelector('button[data-action="ok"]');
    ok?.click();
    await H.sleep(500);
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    await H.sleep(500);
    return { prompt: true, pressed: !!ok };
  },
  /** One client point per cell asked for, found by scanning the viewport for bare canvas well inside the scene. */
  pointsFor: async ({ cells, avoid = [] }) => {
    const r = canvas.dimensions.sceneRect;
    const snap = () => `${canvas.stage.scale.x.toFixed(3)}:${Math.round(canvas.stage.pivot.x)}:${Math.round(canvas.stage.pivot.y)}`;
    let last = "";
    for (let n = 0; n < 12; n++) {
      canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: 0.5 });
      await new Promise((res) => setTimeout(res, 500));
      const now = snap();
      if (now === last) break;
      last = now;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const found = [];
    for (let y = 20; y < H - 20; y += 30) {
      for (let x = 20; x < W - 20; x += 30) {
        if (document.elementFromPoint(x, y) !== canvas.app.view) continue;
        const back = canvas.canvasCoordinatesFromClient({ x, y });
        if (back.x >= r.x + 100 && back.y >= r.y + 100 && back.x <= r.x + r.width - 100 && back.y <= r.y + r.height - 100) found.push({ x, y });
      }
    }
    if (!found.length) {
      // The scan maps no spot inside the scene: fall back to the scene's own cells mapped to the client, kept where the bare canvas lies under them.
      for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.3], [0.7, 0.7]]) {
        const p = canvas.clientCoordinatesFromCanvas({ x: r.x + r.width * fx, y: r.y + r.height * fy });
        if (p.x > 0 && p.y > 0 && p.x < W && p.y < H && document.elementFromPoint(p.x, p.y) === canvas.app.view) found.push({ x: Math.round(p.x), y: Math.round(p.y) });
      }
    }
    if (!found.length) {
      const top = document.elementFromPoint(W / 2, H / 2);
      const at = top ? `${top.tagName.toLowerCase()}.${[...top.classList].join(".")}#${top.id}` : "nothing";
      const mid = canvas.canvasCoordinatesFromClient({ x: W / 2, y: H / 2 });
      return cells.map(() => ({
        x: 0, y: 0, onCanvas: false, at, W, H, scene: canvas.scene?.id ?? null, isView: top === canvas.app.view,
        view: [Number(canvas.stage.scale.x.toFixed(3)), Math.round(canvas.stage.pivot.x), Math.round(canvas.stage.pivot.y)],
        rect: [r.x, r.y, r.width, r.height], mid: [Math.round(mid.x), Math.round(mid.y)], hidden: document.hidden,
      }));
    }
    const cx = found.reduce((a, p) => a + p.x, 0) / found.length;
    const cy = found.reduce((a, p) => a + p.y, 0) / found.length;
    found.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const apart = Math.max(120, canvas.dimensions.size * canvas.stage.scale.x * 1.5);
    const out = [];
    for (const _cell of cells) {
      const pick = found.find((p) => [...out, ...avoid].every((o) => Math.hypot(p.x - o.x, p.y - o.y) >= apart));
      out.push(pick ? { x: pick.x, y: pick.y, onCanvas: true } : { x: 0, y: 0, onCanvas: false });
    }
    return out;
  },
  summonTokens: async ({ sceneId, summonerUuid }) =>
    [...game.scenes.get(sceneId).tokens]
      .filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === summonerUuid)
      .map((t) => ({ uuid: t.uuid, record: t.actor.getFlag("acks-extras", "summon") ?? null })),
  copiesOf: async ({ sourceUuid }) => game.actors.filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid).map((a) => a.uuid),
  firstCreature: async () => {
    const { summonShelves } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    return summonShelves()[0]?.entries?.[0]?.uuid ?? null;
  },
  castCount: async ({ actorId, spellId }) => game.actors.get(actorId).items.get(spellId)?.system?.cast ?? null,
  /** The caster records one cast left on the actor. */
  recordsOf: async ({ actorId, castId }) =>
    game.actors.get(actorId).effects
      .filter((e) => e.getFlag("acks-extras", "spellEffect")?.castId === castId)
      .map((e) => ({ uuid: e.uuid, role: e.getFlag("acks-extras", "spellEffect").role, ended: e.getFlag("acks-extras", "spellEffect").ended ?? null, value: e._source.duration?.value ?? null, units: e._source.duration?.units ?? null })),
  messageIds: async () => game.messages.map((m) => m.id),
  /** Messages made since the ids given that speak as the actor or carry a cast-ended card for it. */
  newMessages: async ({ since, actorId, actorUuid }) =>
    game.messages.filter((m) => !since.includes(m.id) && (m.speaker?.actor === actorId || m.getFlag("acks-extras", "castEnded")?.casterUuid === actorUuid)).map((m) => m.uuid),
  /** The cast-ended cards for one cast, as this seat sees them. */
  endedCards: async ({ castId, playerId }) =>
    game.messages
      .filter((m) => m.getFlag("acks-extras", "castEnded")?.castId === castId)
      .map((m) => ({ id: m.id, uuid: m.uuid, toPlayer: m.whisper.includes(playerId), toGM: m.whisper.some((id) => game.users.get(id)?.isGM), whispered: m.whisper.length > 0, visible: m.visible })),
  /** Move the world clock forward; answers the new time. */
  advance: async ({ seconds }) => {
    await game.time.advance(seconds);
    await new Promise((r) => setTimeout(r, 2500));
    return game.time.worldTime;
  },
  /** Press the Dismiss button of a rendered cast-ended card on this seat. */
  pressCardDismiss: async ({ messageId }) => {
    const H = globalThis.__cs;
    try { ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* the log renders either way */ }
    const button = await H.poll(() => document.querySelector(`[data-message-id="${messageId}"] [data-acks-extras-cast-dismiss]`), { tries: 30, every: 200 });
    if (!button) return { button: false };
    button.click();
    return { button: true };
  },
  viewport: async () => ({ w: window.innerWidth, h: window.innerHeight }),
  /** A summoning straight through lib on a character this seat does not own: the answer, or `{timeout: true}` where it reached placement. */
  placeOn: async ({ actorId, sourceUuid }) => {
    const call = acksExtras.lib.summons.placeSummons(game.actors.get(actorId), { sourceUuid, count: 1 });
    return Promise.race([call, new Promise((r) => setTimeout(() => r({ timeout: true }), 5000))]);
  },
  /** Answer the open confirmation dialog. */
  confirm: async ({ action }) => {
    const H = globalThis.__cs;
    const b = await H.poll(() => [...document.querySelectorAll(".application.dialog button, dialog button")].find((x) => x.dataset.action === action), { tries: 30 });
    if (!b) return false;
    b.click();
    await H.sleep(1500);
    return true;
  },
  /** The Magic tab's summoning rows: the standing count's face and tooltip, and whether Dismiss is offered. */
  magicRows: async ({ actorId, spellIds }) => {
    const H = globalThis.__cs;
    const sheet = game.actors.get(actorId).sheet;
    if (!sheet.rendered) { await sheet.render(true); await H.poll(() => H.root(sheet)?.isConnected); }
    sheet.changeTab("magic", "primary");
    await H.sleep(700);
    return spellIds.map((id) => {
      const row = H.root(sheet)?.querySelector(`[data-item-id='${id}']`);
      const count = row?.querySelector("[data-tooltip-text]");
      const dismiss = row?.querySelector("[data-action='spellDismiss']");
      return { row: !!row, face: count?.textContent.trim() ?? null, tipped: !!count?.dataset.tooltipText, named: !!dismiss?.getAttribute("aria-label"), dismiss: !!dismiss };
    });
  },
  pressMagicDismiss: async ({ actorId, spellId }) => {
    const H = globalThis.__cs;
    const sheet = game.actors.get(actorId).sheet;
    const button = H.root(sheet)?.querySelector(`[data-item-id='${spellId}'] [data-action='spellDismiss']`);
    if (!button) return false;
    button.click();
    return true;
  },
  controlOnly: async ({ tokenId }) => {
    canvas.tokens.activate();
    canvas.tokens.releaseAll();
    const t = canvas.tokens.get(tokenId);
    if (!t) return false;
    t.control({ releaseOthers: true });
    await new Promise((r) => setTimeout(r, 400));
    return canvas.tokens.controlled.length === 1;
  },
  boundTo: async ({ uuid }) => (await fromUuid(uuid))?.actor?.getFlag("acks-extras", "summonedBy") ?? null,
  /** Let go of a hand-bound token a past run left bound, so the walk starts from its known shape. */
  unbind: async ({ uuid }) => { await (await fromUuid(uuid))?.actor?.unsetFlag("acks-extras", "summonedBy"); return true; },
  restore: async () => {
    const H = globalThis.__cs;
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

/** Attach a second DevTools session, register the boot recorder for the next document, and reload. */
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
/** Bring a seat's page to the front, so its canvas lays out and renders. */
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

/**
 * Rest the seat's real pointer in the middle of its viewport. While previews are
 * placed, core pans the view toward any edge the pointer sits within 50 px of,
 * and every pan replays the last pointer position, so a pointer left at the
 * page's corner runs the view off the scene before a point can be read.
 */
async function pointerToMiddle(api, port) {
  const { w, h } = await run(api, P.viewport);
  const s = await pageSession(port);
  await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(w / 2), y: Math.round(h / 2) });
  s.close();
  await sleep(400);
}

/** Poll a page read until `test(result)` holds or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 60, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
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

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm, PORTS.gm, "gm"));
  note("player reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(player, PORTS.player, "player"));
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  check("the GM seat is the active GM and the player seat is a player, both with the summoning cast", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2 && installed.castApi && seated.castApi, { gm: installed.role, player: seated.role });
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    const boot = await run(seat, P.boot);
    check(`${label}: the recorder ran before Foundry's scripts and saw no error from init on`, boot.recorded && boot.preFoundry && boot.errors === 0 && boot.castExpiryError === false, { errors: boot.errors });
  }
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const scene = await gm.fixture("summons/scene", "Scene", {
    name: "QA Summoning Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 },
  });
  const summoner = await gm.fixture("summons/summoner", "Actor", {
    name: "QA Summoner", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 }, spells: { enabled: true } }, ownership: { default: 0, [playerId]: 3 },
  });
  const stranger = await gm.fixture("summons/stranger", "Actor", { name: "QA Stranger", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 2 } });
  await gm.fixture("summons/summoner-token", "Token", { name: "QA Summoner", actorId: idOf(summoner), actorLink: true, x: 100, y: 100, width: 1, height: 1 }, { parent: scene.uuid });
  const spike = await gm.fixture("summons/spike-source", "Actor", { name: "QA Spike Source", type: "monster", ownership: { default: 0 } });
  const bindable = await gm.fixture("summons/bindable", "Token", {
    name: "QA Bindable", actorId: idOf(spike), actorLink: false, x: 1100, y: 700, width: 1, height: 1, delta: { ownership: { [playerId]: 3 } },
  }, { parent: scene.uuid });
  const namedName = "QA Named Calling";
  const openName = "QA Open Calling";
  const named = await gm.fixture("summons/spell-named", "Item", { name: namedName, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: summoner.uuid });
  const open = await gm.fixture("summons/spell-open", "Item", { name: openName, type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: summoner.uuid });
  const summonerId = idOf(summoner);
  const sceneId = idOf(scene);
  const namedId = idOf(named);
  const openId = idOf(open);
  const summonerUuid = `Actor.${summonerId}`;
  const spikeUuid = `Actor.${idOf(spike)}`;
  const shaped = await run(gm, P.shape, { actorId: summonerId, namedId, openId, namedRef: spikeUuid, duration: NAMED_DURATION });
  check("shape: spells enabled and both spells read as summoning spells", shaped.enabled && shaped.named && shaped.open, shaped);
  // A past run that stopped between Bind and Release leaves the bindable token bound; the walk starts with it free.
  if ((await run(gm, P.boundTo, { uuid: bindable.uuid })) === summonerUuid) await run(gm, P.unbind, { uuid: bindable.uuid });
  const tokens = () => run(gm, P.summonTokens, { sceneId, summonerUuid });
  const before = await tokens();
  check("start: the summoner has no summons on the field", before.length === 0, { n: before.length });
  if (before.length) throw new Error("leftover summons on the field from a run that did not sweep");
  check("the Player seat views the field without activating it", await run(player, P.view, { sceneId }));
  check("the GM seat views the field", await run(gm, P.view, { sceneId }));
  const spikeCopiesBefore = await run(gm, P.copiesOf, { sourceUuid: spikeUuid });
  const messagesBefore = await run(gm, P.messageIds);
  const castMenu = { named: `Cast ${namedName}`, open: `Cast ${openName}` };
  await run(player, P.drain);
  await run(gm, P.drain);

  section("1. the party cell offers each summoning spell's Cast, and no spell-less Summon… to the Player");
  const m1 = await run(player, P.menu, { actorId: summonerId });
  check("1: Cast is offered for both summoning spells", m1.cell && m1.items.includes(castMenu.named) && m1.items.includes(castMenu.open), { n: m1.items.length });
  check("1: no Summon… and no Dismiss is offered", !m1.items.includes("Summon…") && !m1.items.some((l) => l.startsWith("Dismiss")));

  section("2. Cast from the cell places the named creature, and the cell turns to its Dismiss");
  check("2: Cast is picked", await run(player, P.pick, { label: castMenu.named }));
  const p2 = await run(player, P.prompt);
  check("2: the prompt offers the spell's one creature and opens on its count", p2.prompt && p2.values.length === 1 && p2.values[0] === spikeUuid && p2.count === "2", { choices: p2.values?.length, count: p2.count });
  check("2: Place on the map is pressed", (await run(player, P.answer, { count: 2 })).pressed);
  await frontSeat(PORTS.player);
  await pointerToMiddle(player, PORTS.player);
  const clicked = [];
  for (let i = 0; i < 2; i++) {
    const [p] = await run(player, P.pointsFor, { cells: [i], avoid: clicked });
    if (!p.onCanvas) throw new Error(`no bare canvas to click: ${JSON.stringify(p)}`);
    await clickAt(PORTS.player, p);
    clicked.push(p);
  }
  let placed = [];
  for (let n = 0; n < 40 && placed.length < 2; n++) { placed = await tokens(); if (placed.length < 2) await sleep(300); }
  for (const t of placed) await track(t.uuid, "Token");
  check("2: two clicks place two tokens of one cast, naming the spell", placed.length === 2 && new Set(placed.map((t) => t.record?.castId)).size === 1 && placed.every((t) => t.record?.spellId === namedId), { n: placed.length });
  if (placed.length !== 2) throw new Error("the cast placed no creatures; every later step reads its tokens");
  const namedCast = placed[0].record.castId;
  const count2 = await until(player, P.castCount, { actorId: summonerId, spellId: namedId }, (c) => c === 1, { tries: 40, every: 250 });
  check("2: the spell's cast count is 1", count2 === 1, { cast: count2 });
  const rec2 = await until(gm, P.recordsOf, { actorId: summonerId, castId: namedCast }, (r) => r.length >= 1, { tries: 30, every: 250 });
  for (const r of rec2) await track(r.uuid, "ActiveEffect");
  check("2: one caster record carries the cast id and the spell's invented minute", rec2.length === 1 && rec2[0].role === "caster" && rec2[0].ended === null && rec2[0].value === 1 && rec2[0].units === "minutes", { n: rec2.length, units: rec2[0]?.units });
  const spikeCopies = await run(gm, P.copiesOf, { sourceUuid: spikeUuid });
  if (!spikeCopiesBefore.length) for (const uuid of spikeCopies) await track(uuid, "Actor");
  await run(player, P.clearWindows);
  const m2 = await run(player, P.menu, { actorId: summonerId });
  check("2: the cell now offers the named spell's Dismiss with its count of 2, and no Cast for it", m2.items.includes(`Dismiss ${namedName} (2)`) && !m2.items.includes(castMenu.named) && m2.items.includes(castMenu.open));
  await run(player, P.closeMenu);

  section("3. the Magic tab shows each summoning spell's standing count, and Dismiss where some stand");
  const rows3 = await run(player, P.magicRows, { actorId: summonerId, spellIds: [namedId, openId] });
  check("3: the named spell's row reads 2 standing with a tooltip, and offers a named Dismiss", rows3[0].row && rows3[0].face === "2 standing" && rows3[0].tipped && rows3[0].dismiss && rows3[0].named, rows3[0]);
  check("3: the open spell's row reads 0 standing and offers no Dismiss", rows3[1].row && rows3[1].face === "0 standing" && rows3[1].tipped && !rows3[1].dismiss, rows3[1]);
  await run(player, P.clearWindows);

  section("4. a second spell cast from an open shelf adds Dismiss all");
  const shelf = await run(player, P.firstCreature);
  check("4: the Player can open a monster compendium", !!shelf);
  if (!shelf) throw new Error("no monster compendium is open to the Player seat");
  const shelfCopiesBefore = await run(gm, P.copiesOf, { sourceUuid: shelf });
  await run(player, P.menu, { actorId: summonerId });
  check("4: Cast is picked for the open spell", await run(player, P.pick, { label: castMenu.open }));
  const p4 = await run(player, P.prompt);
  check("4: the prompt offers the shelf the Player can open", p4.prompt && p4.values.includes(shelf), { choices: p4.values?.length });
  await run(player, P.answer, { count: 1 });
  await frontSeat(PORTS.player);
  await pointerToMiddle(player, PORTS.player);
  const [p4pt] = await run(player, P.pointsFor, { cells: [0], avoid: clicked });
  if (!p4pt.onCanvas) throw new Error("no bare canvas left for the second cast");
  await clickAt(PORTS.player, p4pt);
  let after4 = [];
  for (let n = 0; n < 40 && after4.length < 3; n++) { after4 = await tokens(); if (after4.length < 3) await sleep(300); }
  for (const t of after4) await track(t.uuid, "Token");
  const openTok = after4.find((t) => t.record?.spellId === openId);
  check("4: one more token stands, of a second cast naming the open spell", after4.length === 3 && !!openTok && openTok.record.castId !== namedCast, { n: after4.length });
  const openCast = openTok?.record?.castId ?? "";
  const rec4 = await until(gm, P.recordsOf, { actorId: summonerId, castId: openCast }, (r) => r.length >= 1, { tries: 30, every: 250 });
  for (const r of rec4) await track(r.uuid, "ActiveEffect");
  check("4: its caster record has no duration", rec4.length === 1 && rec4[0].value === null, { n: rec4.length });
  const shelfCopies = await run(gm, P.copiesOf, { sourceUuid: shelf });
  if (!shelfCopiesBefore.length) for (const uuid of shelfCopies) await track(uuid, "Actor");
  await run(player, P.clearWindows);
  const m4 = await run(player, P.menu, { actorId: summonerId });
  check("4: the cell offers both spells' Dismiss and Dismiss all, and neither Cast", m4.items.includes(`Dismiss ${namedName} (2)`) && m4.items.includes(`Dismiss ${openName} (1)`) && m4.items.includes("Dismiss all summons") && !m4.items.some((l) => l.startsWith("Cast ")));
  await run(player, P.closeMenu);

  section("5. the clock passes the first cast's duration: one whispered card, once");
  const t0 = await run(gm, P.advance, { seconds: 0 });
  check("5: no card stands before the clock moves", (await run(gm, P.endedCards, { castId: namedCast, playerId })).length === 0);
  const t1 = await run(gm, P.advance, { seconds: 61 });
  note("5: world clock moved forward (s)", t1 - t0);
  const cards = await until(gm, P.endedCards, { castId: namedCast, playerId }, (c) => c.length >= 1, { tries: 40, every: 250 });
  for (const c of cards) await track(c.uuid, "ChatMessage");
  check("5: one card for the run-out cast, whispered to the Player and the GM", cards.length === 1 && cards[0].whispered && cards[0].toPlayer && cards[0].toGM, { n: cards.length });
  const rec5 = await run(gm, P.recordsOf, { actorId: summonerId, castId: namedCast });
  check("5: the record is stamped ended", rec5.length === 1 && rec5[0].ended !== null);
  check("5: the cast with no duration posts no card", (await run(gm, P.endedCards, { castId: openCast, playerId })).length === 0);
  await run(gm, P.advance, { seconds: 1 });
  note("5: world clock moved forward again (s)", 1);
  await sleep(1500);
  check("5: a further step of the clock posts no second card", (await run(gm, P.endedCards, { castId: namedCast, playerId })).length === 1);
  check("5: the creatures still stand: the card tells, it does not remove", (await tokens()).length === 3);

  section("6. the card's Dismiss on the Player seat removes that cast, and nothing else");
  const seen6 = await run(player, P.endedCards, { castId: namedCast, playerId });
  check("6: the Player seat sees the card", seen6.length === 1 && seen6[0].visible);
  const declined6 = await run(player, P.pressCardDismiss, { messageId: cards[0]?.id ?? "" });
  check("6: the card's Dismiss button is rendered on the Player seat and pressed", declined6.button);
  check("6: the confirmation is answered No", await run(player, P.confirm, { action: "no" }));
  check("6: No removes nothing", (await tokens()).length === 3);
  const pressed6 = await run(player, P.pressCardDismiss, { messageId: cards[0]?.id ?? "" });
  check("6: the card's Dismiss is pressed again", pressed6.button);
  check("6: the confirmation is answered Yes", await run(player, P.confirm, { action: "yes" }));
  const after6 = await until(gm, P.summonTokens, { sceneId, summonerUuid }, (t) => t.length === 1, { tries: 30, every: 300 });
  check("6: the named cast's two tokens are gone and the open cast's one stands", after6.length === 1 && after6[0].record?.castId === openCast, { n: after6.length });

  section("7. the Magic tab's Dismiss removes the other cast");
  await run(player, P.magicRows, { actorId: summonerId, spellIds: [openId] });
  check("7: the open spell's Dismiss is pressed", await run(player, P.pressMagicDismiss, { actorId: summonerId, spellId: openId }));
  check("7: the confirmation is answered Yes", await run(player, P.confirm, { action: "yes" }));
  const after7 = await until(gm, P.summonTokens, { sceneId, summonerUuid }, (t) => t.length === 0, { tries: 30, every: 300 });
  check("7: no summons stand", after7.length === 0, { n: after7.length });
  await run(player, P.clearWindows);
  const m7 = await run(player, P.menu, { actorId: summonerId });
  check("7: the cell offers both Casts again", m7.items.includes(castMenu.named) && m7.items.includes(castMenu.open));
  await run(player, P.closeMenu);

  section("8. a creature bound by hand: Release, never Dismiss");
  await run(player, P.clearWindows);
  check("8: the Player controls the bindable token alone", await run(player, P.controlOnly, { tokenId: idOf(bindable) }));
  const m8 = await run(player, P.menu, { actorId: summonerId });
  const bind = m8.items.find((l) => l.startsWith("Bind "));
  check("8: the cell offers Bind for the controlled token", !!bind);
  if (bind) await run(player, P.pick, { label: bind });
  await sleep(800);
  check("8: the bound token names the summoner", (await run(gm, P.boundTo, { uuid: bindable.uuid })) === summonerUuid);
  const m8b = await run(player, P.menu, { actorId: summonerId });
  const release = m8b.items.find((l) => l.startsWith("Release"));
  check("8: Release is offered, and no Dismiss reaches the bound token", !!release && !m8b.items.some((l) => l.startsWith("Dismiss")));
  if (release) await run(player, P.pick, { label: release });
  await sleep(800);
  check("8: Release lets it go", (await run(gm, P.boundTo, { uuid: bindable.uuid })) == null);

  section("9. a character the Player does not own, and the GM seat");
  await run(player, P.clearWindows);
  const m9 = await run(player, P.menu, { actorId: idOf(stranger) });
  check("9: the stranger's cell offers neither Cast nor Summon…", m9.cell && !m9.items.some((l) => l.startsWith("Cast ")) && !m9.items.includes("Summon…"));
  await run(player, P.clearWindows);
  const refused9 = await run(player, P.placeOn, { actorId: idOf(stranger), sourceUuid: shelf });
  check("9: a summoning sent through lib for the stranger is refused notOwner, before any click", refused9?.ok === false && refused9.reason === "notOwner", refused9);
  check("9: the stranger has no summons on the field", (await run(gm, P.summonTokens, { sceneId, summonerUuid: `Actor.${idOf(stranger)}` })).length === 0);
  const mGM = await run(gm, P.menu, { actorId: summonerId });
  check("9: the GM seat's cell for the summoner offers Summon… beside both Casts", mGM.items.includes("Summon…") && mGM.items.includes(castMenu.named) && mGM.items.includes(castMenu.open));
  await run(gm, P.clearWindows);

  for (const uuid of await run(gm, P.newMessages, { since: messagesBefore, actorId: summonerId, actorUuid: summonerUuid })) await track(uuid, "ChatMessage");
  const pEnd = await run(player, P.drain);
  const gEnd = await run(gm, P.drain);
  check("no console error or uncaught error on the Player seat over the walk", !pEnd.errors.length && !pEnd.uncaught.length, { errors: pEnd.errors.length, uncaught: pEnd.uncaught.length });
  check("no console error or uncaught error on the GM seat over the walk", !gEnd.errors.length && !gEnd.uncaught.length, { errors: gEnd.errors.length, uncaught: gEnd.uncaught.length });
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
  console.log("fixtures kept: summons/scene, summons/summoner, summons/summoner-token, summons/spell-named, summons/spell-open, summons/stranger, summons/spike-source, summons/bindable");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
