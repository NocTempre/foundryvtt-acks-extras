/**
 * The shared half of the treasure walks `treasure-faces.mjs` and
 * `treasure-party.mjs`: the check printer, the seat plumbing (boot recorder,
 * real pointer press, readiness), and the page-side functions both walks run
 * on a seat (`P`, installed under `globalThis.__tk`). A walk spreads `P` into
 * its own page functions and adds the ones only it needs. The underscore keeps
 * the runner from taking this file for a walk. Nothing here names a path, a
 * port, a world or a user: the machine's values arrive through ./_env.mjs.
 */
import { sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

export { PORTS, sleep };
export const MACHINE = machineSeats();
export const LANG = "ACKS-TREASURE";

export const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
export const section = (title) => console.log(`\n== ${title} ==`);
export const checks = [];
export const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
export const clicks = { real: 0, scripted: 0 };
export const idOf = (fx) => fx.id ?? String(fx.uuid).split(".").pop();

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
export const RECORDER = `(() => {
  const R = (globalThis.__tkBoot = { phase: "load", phases: [], errors: [] });
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

/** Page-side functions, stringified and run in a seat's page. */
export const P = {
  install: async ({ lang }) => {
    const H = (globalThis.__tk = globalThis.__tk ?? {});
    const base = "/modules/acks-extras/scripts";
    H.LANG = lang;
    H.S = await import(`${base}/lib/sockets.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.race = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r({ timeout: true }), ms))]);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.t = (key, data) => {
      const full = H.LANG + "." + key;
      return data ? game.i18n.format(full, data) : game.i18n.localize(full);
    };
    H.pile = (potId) => game.cards.get(potId) ?? null;
    H.sheet = (potId) => H.pile(potId)?.sheet ?? null;
    H.dialog = () => [...foundry.applications.instances.values()].find((a) => a.rendered && a.options?.classes?.includes("acks-extras-treasure-dialog")) ?? null;
    H.opened = H.opened ?? [];
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.notifyWarn = ui.notifications.warn.bind(ui.notifications);
      H.notifyInfo = ui.notifications.info.bind(ui.notifications);
      H.infos = [];
      ui.notifications.warn = (msg, opts) => { H.warns.push(String(msg)); return H.notifyWarn(msg, opts); };
      ui.notifications.info = (msg, opts) => { H.infos.push(String(msg)); return H.notifyInfo(msg, opts); };
    }
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      userId: game.user.id,
      activeGM: !!game.users.activeGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      socketlib: typeof globalThis.socketlib !== "undefined",
      treasure: !!globalThis.acksExtras?.treasure,
      boot: globalThis.__tkBoot ?? null,
    };
  },
  t: async ({ key, data }) => globalThis.__tk.t(key, data),
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** The seat's notifications since the last call, then cleared. */
  takeNotes: async () => {
    const H = globalThis.__tk;
    const out = { warns: H.warns.slice(), infos: H.infos.slice() };
    H.warns = [];
    H.infos = [];
    return out;
  },

  /** Resolve a control and report where a real pointer would land on it. `scope`: `doc`, `sheet` (the pot's window) or `dialog`. */
  locate: async ({ scope, potId, sel, nth = 0 }) => {
    const H = globalThis.__tk;
    const root = scope === "sheet" ? H.root(H.sheet(potId)) : scope === "dialog" ? H.root(H.dialog()) : document;
    if (!root) return { found: false, why: "no scope" };
    const list = [...root.querySelectorAll(sel)];
    const el = list[nth] ?? null;
    H.target = el;
    if (!el) return { found: false, count: list.length };
    el.scrollIntoView({ block: "center", inline: "center" });
    await H.sleep(150);
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const hit = r.width > 0 && r.height > 0 ? document.elementFromPoint(x, y) : null;
    return { found: true, ok: !!hit && (hit === el || el.contains(hit)), x, y, disabled: !!el.disabled, count: list.length };
  },
  pressTarget: async () => {
    const H = globalThis.__tk;
    if (!H.target) return false;
    H.target.click();
    return true;
  },

  /** Make a pot through the function the scene control's tool calls, and wait for its window. */
  newPot: async () => {
    const H = globalThis.__tk;
    H.before = new Set(foundry.applications.instances.values());
    await acksExtras.treasure.newPot();
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !H.before.has(a) && a.rendered && a.constructor.name === "PotSheet") ?? null, { tries: 60, every: 250 });
    if (!app) return null;
    H.opened.push(app);
    await H.sleep(500);
    return { potId: app.document.id, uuid: app.document.uuid, name: app.document.name };
  },
  /** Dispatch the drop a drag of an item makes onto a zone, and wait until the card and its listing both landed. */
  dropAndWait: async ({ potId, zone, uuid }) => {
    const H = globalThis.__tk;
    const pile = H.pile(potId);
    const el = H.root(pile.sheet)?.querySelector(`[data-accept-drop='${zone}']`);
    if (!el) return { ok: false, why: "no zone" };
    const before = new Set(pile.cards.map((c) => c.id));
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const ids = await H.poll(() => {
      const f = pile.getFlag("acks-extras", "treasure") ?? {};
      const listed = new Set([...(f.order ?? []), ...(f.buckets?.add ?? []), ...(f.buckets?.replace ?? [])]);
      const fresh = pile.cards.filter((c) => !before.has(c.id));
      return fresh.length && fresh.every((c) => listed.has(c.id)) ? fresh.map((c) => c.id) : null;
    });
    await H.sleep(300);
    return { ok: !!ids, ids: ids ?? [] };
  },
  /** The pile, its flag and every card's truth, as a seat's page holds them. */
  stage: async ({ potId }) => {
    const H = globalThis.__tk;
    const pile = H.pile(potId);
    if (!pile) return { gone: true };
    const f = pile.getFlag("acks-extras", "treasure") ?? {};
    return {
      gone: false,
      name: pile.name,
      phase: f.phase ?? null,
      order: f.order ?? [],
      messageId: f.messageId ?? null,
      toggles: f.deal?.toggles ?? null,
      grab: f.grab ?? null,
      partyId: f.partyId ?? null,
      cards: pile.cards.contents.map((c) => {
        const t = c.getFlag("acks-extras", "card") ?? {};
        return {
          id: c.id, uuid: c.uuid, face: c.face ?? null, faceName: c.faces?.[0]?.name ?? null, suit: c.suit, value: c.value, backImg: c.back?.img ?? null,
          pool: t.pool ?? null, label: t.label ?? "", coin: t.coin ?? null, claimedBy: t.claimedBy ?? null, weight6: t.weight6 ?? null, cursed: t.source?.data?.flags?.["acks-extras"]?.markets?.cursed ?? null,
          curseKnown: t.source?.data?.flags?.["acks-extras"]?.markets?.curseKnown ?? null,
        };
      }),
    };
  },
  waitState: async ({ potId, until, cardId = null, phase = null }) => {
    const H = globalThis.__tk;
    const met = () => {
      const pile = H.pile(potId);
      if (until === "gone") return !pile;
      if (!pile) return false;
      const f = pile.getFlag("acks-extras", "treasure") ?? {};
      if (until === "phase") return f.phase === phase;
      const card = pile.cards.get(cardId);
      if (!card) return false;
      if (until === "up") return card.face === 0;
      if (until === "claimed") return !!card.getFlag("acks-extras", "card")?.claimedBy;
      return false;
    };
    return { met: !!(await H.poll(met, { tries: 60, every: 250 })) };
  },
  waitSheet: async ({ potId }) => {
    const H = globalThis.__tk;
    const app = await H.poll(() => { const s = H.sheet(potId); return s?.rendered && H.root(s)?.querySelector("li[data-card-id], .acks-extras-treasure__empty") ? s : null; }, { tries: 60, every: 250 });
    if (app && !H.opened.includes(app)) H.opened.push(app);
    await H.sleep(300);
    return { rendered: !!app, pile: !!H.pile(potId), errors: H.errors.slice(-3) };
  },
  rerender: async ({ potId }) => {
    const H = globalThis.__tk;
    const app = H.sheet(potId);
    if (app?.rendered) await app.render();
    await H.sleep(600);
    return true;
  },
  /** The doorway chat card of a pot on this seat, found by the pot's uuid. */
  doorFor: async ({ uuid }) => {
    const ms = game.messages.filter((m) => m.flags?.["acks-extras"]?.treasure?.uuid === uuid);
    return { messages: ms.length, ids: ms.map((m) => m.id), rendered: ms.filter((m) => !!document.querySelector(`[data-message-id='${m.id}'] .acks-extras-treasure-door`)).length };
  },
  relay: async ({ potId, op, cardId, actorUuid }) => {
    const H = globalThis.__tk;
    const payload = { potId, op, cardId };
    if (actorUuid !== undefined) payload.actorUuid = actorUuid;
    const r = await H.race(H.S.executeAsGM("treasurePot", payload), 25000);
    return r === undefined ? { none: true } : r;
  },
  actorRows: async ({ actorId }) => (game.actors.get(actorId)?.items ?? []).map((i) => {
    const m = i.getFlag("acks-extras", "markets") ?? {};
    return { id: i.id, uuid: i.uuid, name: i.name, qty: typeof i.system?.quantity === "number" ? i.system.quantity : Number(i.system?.quantity?.value ?? 0), cursed: m.cursed ?? null, curseKnown: m.curseKnown ?? null };
  }),
  closeAll: async () => {
    const H = globalThis.__tk;
    let n = 0;
    for (const app of H?.opened ?? []) { try { await app.close({ force: true, animate: false }); n++; } catch { /* already closed */ } }
    if (H) H.opened = [];
    return n;
  },
  drain: async () => ({ errors: globalThis.__tk.errors.slice() }),
  restore: async () => {
    const H = globalThis.__tk;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.warn = H.notifyWarn;
    ui.notifications.info = H.notifyInfo;
    H.patched = false;
    return "restored";
  },
};

/** Run a page function on a seat and parse its JSON answer. */
export async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
export const t = (api, key, data) => run(api, P.t, { key, data });

/** Wait until the seat's page is a ready game with the treasure feature loaded. */
export async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.treasure`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** A CDP session on the seat's page: the boot recorder, and the real pointer. */
export async function cdp(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((x) => x.type === "page" && x.url.startsWith(MACHINE.origin));
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

/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
export async function record(port, label, api) {
  const s = await cdp(port);
  await s.send("Page.enable");
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await s.send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  s.close();
  return seconds;
}

/** Press a control with a real pointer when its centre is the control, else `click()` and say so. */
export async function press(api, port, spec, label) {
  const at = await run(api, P.locate, spec);
  if (!at?.found) return { found: false, count: at?.count ?? 0 };
  if (at.disabled) return { found: true, disabled: true };
  if (at.ok) {
    const s = await cdp(port);
    try {
      await s.send("Page.bringToFront");
      await s.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await sleep(120);
      await s.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
      await sleep(60);
      await s.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
    } finally {
      s.close();
    }
    clicks.real++;
    await sleep(300);
    return { found: true, real: true };
  }
  await run(api, P.pressTarget);
  clicks.scripted++;
  note(`scripted click (the control was not the element under its centre)`, label ?? spec.sel);
  await sleep(300);
  return { found: true, real: false };
}

/** The seats' boot checks every treasure walk opens with. Returns the two installs. */
export async function openSeats({ gm, player, blocked, pattern }) {
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  const seatG = await run(gm, P.install, { lang: LANG });
  const seatP = await run(player, P.install, { lang: LANG });
  if (!seatG.isGM || !seatG.activeGMIsSelf) blocked("the GM seat is not the active GM: another GM client holds it, so a player's relayed request would reach that client and not this one");
  if (seatP.isGM || seatP.role > 2) blocked("the player seat is not a player");
  if (!seatP.activeGM || !seatP.socketlib) blocked("the player seat cannot reach a GM client (no active GM, or socketlib is absent)");
  check("the GM seat is the active GM and the player seat is a player with a GM to reach", seatG.isGM && seatG.activeGMIsSelf && !seatP.isGM && seatP.activeGM && seatP.socketlib, { gm: seatG.role, player: seatP.role });
  for (const [key, c] of Object.entries({ gm: seatG, player: seatP })) {
    const phases = c.boot?.phases ?? [];
    const errors = c.boot?.errors ?? [];
    const naming = errors.filter((e) => pattern.test(e.text));
    note(`${key}: errors recorded from load through ready (any text)`, errors.length);
    check(`${key}: init, setup and ready ran and no error names a treasure file`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && naming.length === 0 && c.treasure, { phases, naming: naming.length, api: c.treasure });
  }
  return { seatG, seatP };
}

/** Print the summary and set the exit code. */
export function finish() {
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}

/** A wall clock that closes the seats and exits, so a hung run leaves no browser behind. */
export function watchdog(seats, ms = Number(process.env.WALK_WALL_MS ?? 500_000)) {
  setTimeout(() => {
    console.error(`WALK ERROR: wall clock of ${ms} ms reached; closing the seats`);
    for (const s of seats()) { try { s?.close(); } catch {} }
    process.exit(1);
  }, ms).unref();
}
