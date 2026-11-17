/**
 * Live walk, treasure search: the treasure pot's "Search the fallen", slice R6.
 * Walks docs/treasure/TESTING.md "Search the fallen (Judge seat, a real fight)"
 * on both seats. A hostile combatant whose token carries goods is knocked down,
 * the combat is ended by the tracker's own End Combat button and its confirm,
 * so the real `deleteCombat` hook fires on the primary GM's client; nothing here
 * calls the hook. Every observable is a boolean or a count. Machine values
 * arrive through ./_env.mjs.
 *
 * Covers: the primary-GM gate; fixtures; steps 1 and 2 (the fight, the whispered
 * card on the Judge seat and not on the Player seat, its rows, its letter and
 * note, the friend left out, the card made once); step 3 (staging from the card:
 * a pot in staging, its three cards, `origin.kind` combat and `carried`, the
 * bodies still carrying, the button's wording after, the second press opening
 * the same pot); a card removed in staging; step 5 (the token of one body
 * deleted before Open); step 6 (Open: `origin.takenOff`, the surviving body
 * without the goods that are cards, the removed card's item still on its body,
 * the natural weapon kept, the deleted body's card still in the pot and still
 * claiming through the real relay, the doorway reaching the Player seat only
 * at Open); the console on both seats; teardown.
 *
 * Fixtures, kept and found by marker: `treasure/search-scene` (a scene),
 * `treasure/search-hostile` (a monster with a goods item, a coin row, a
 * natural-weapon row and a treasure letter), `treasure/search-hostile-2` (a
 * monster with one goods item), `treasure/search-friend` (a character with one
 * goods item) and `treasure/player-character` (a character the Player seat
 * owns). Each step brings the shape it needs before its first check. The
 * tokens and the combat are NOT kept: the take-off writes through an unlinked
 * token's delta and a step deletes a token, so each run places its own tokens
 * and makes its own combat, tracked by id and swept by id (the recipe lists
 * them as kept fixtures; see the report). The search card is the message whose
 * flag names the run's combat, the pot is the card's `stagedPot`, the doorway
 * is the pot flag's `messageId`, and each is tracked the moment it is read.
 *
 * Real gestures: the tracker's End Combat and its confirm, the card's stage
 * button (both presses), the pot's Remove and Open to the table are CDP mouse
 * presses at the control's centre when the control is the element under that
 * point; one that is covered is pressed with `click()` and printed as a note.
 * Scripted: the knock-down (the tracker's own defeat toggle replayed for two
 * bodies, a hit-point write for the third), the token delete, and the Player
 * seat's flip and claim (the relay called by hand, as the sheet offers a
 * claim only through a dialog this walk reaches in treasure.mjs).
 *
 * Not reached: step 4 (a linked table: the draw, the item result, the text
 * result), a second Judge seat reading the card once, the treasure letter
 * dealing cards (nothing deals them yet), a fight on a scene that is viewed,
 * and a hit-point knock-down of a linked token.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const LANG = "ACKS-TREASURE";
const MARKS = {
  scene: "treasure/search-scene",
  hostile: "treasure/search-hostile",
  hostile2: "treasure/search-hostile-2",
  friend: "treasure/search-friend",
  player: "treasure/player-character",
};
const NAMES = { hostile: "QA Search Hostile", hostile2: "QA Search Hostile Two", friend: "QA Search Friend", player: "QA Treasure Player Character" };
const LETTER = "Q";
const GOODS = {
  hostile: [
    { name: "QA Search Trinket", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 30 } },
    { name: "QA Search Coin", type: "money", img: "icons/svg/coins.svg", system: { coppervalue: 100, quantity: 12 } },
    { name: "QA Search Claw", type: "weapon", img: "icons/svg/sword.svg", system: { cost: 0 }, flags: { "acks-extras": { naturalWeapon: true } } },
  ],
  hostile2: [{ name: "QA Search Bauble", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 40 } }],
  friend: [{ name: "QA Search Keepsake", type: "item", img: "icons/svg/item-bag.svg", system: { cost: 20 } }],
};
const CARD_GOODS = 3;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__swBoot = { phase: "load", phases: [], errors: [] });
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

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ lang }) => {
    const H = (globalThis.__sw = globalThis.__sw ?? {});
    const base = "/modules/acks-extras/scripts";
    H.LANG = lang;
    H.S = await import(`${base}/lib/sockets.mjs`);
    H.U = await import(`${base}/lib/util.mjs`);
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
    H.pots = () => game.cards.filter((c) => !!c.flags?.["acks-extras"]?.treasure);
    H.opened = H.opened ?? [];
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    await H.U.primaryGMSettled?.();
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      primary: !!H.U.isPrimaryGM?.(),
      activeGM: !!game.users.activeGM,
      socketlib: typeof globalThis.socketlib !== "undefined",
      treasure: !!globalThis.acksExtras?.treasure,
      boot: globalThis.__swBoot ?? null,
    };
  },
  t: async ({ key, data }) => globalThis.__sw.t(key, data),
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,

  /** Bring the kept actors to the shape every step starts from: their goods by name, the letter, the disposition. */
  shape: async ({ ids, want, letter, playerId }) => {
    const H = globalThis.__sw;
    const wrote = [];
    const got = {};
    for (const [key, items] of Object.entries(want)) {
      const a = game.actors.get(ids[key]);
      if (!a) return { ok: false, missing: key };
      const have = new Set(a.items.map((i) => i.name));
      const miss = items.filter((i) => !have.has(i.name));
      if (miss.length) { await a.createEmbeddedDocuments("Item", miss); wrote.push(`${key}:items`); }
      if (key === "hostile") {
        const t = a.system?.details?.treasure ?? {};
        if (t.type !== letter || (t.table ?? "") !== "") { await a.update({ "system.details.treasure.type": letter, "system.details.treasure.table": "" }); wrote.push("hostile:letter"); }
      }
      if (key !== "friend") {
        if (a.prototypeToken.disposition !== CONST.TOKEN_DISPOSITIONS.HOSTILE || a.prototypeToken.actorLink) { await a.update({ "prototypeToken.disposition": CONST.TOKEN_DISPOSITIONS.HOSTILE, "prototypeToken.actorLink": false }); wrote.push(`${key}:token`); }
      }
      got[key] = { names: a.items.map((i) => i.name).sort(), dup: a.items.size !== new Set(a.items.map((i) => i.name)).size };
    }
    const pc = game.actors.get(ids.player);
    if (!pc) return { ok: false, missing: "player" };
    if ((pc.ownership?.[playerId] ?? 0) < 3) { await pc.update({ [`ownership.${playerId}`]: 3 }); wrote.push("playerOwnership"); }
    return { ok: true, wrote, got, letter: game.actors.get(ids.hostile).system.details.treasure.type, tableBlank: (game.actors.get(ids.hostile).system.details.treasure.table ?? "") === "", playerOwns: pc.testUserPermission(game.users.get(playerId), "OWNER") };
  },
  sees: async ({ ids }) => !!(await globalThis.__sw.poll(() => Object.values(ids).every((id) => !!game.actors.get(id)))),

  /* ---- The fight ------------------------------------------------------- */
  /** Start the combat, read what each combatant resolves to. */
  startFight: async ({ combatId, start = null }) => {
    const c = game.combats.get(combatId);
    if (!c) return { found: false };
    if (start === "update") await c.update({ round: 1, turn: 0 });
    return { found: true, started: !!c.started, round: c.round, rows: c.combatants.map((x) => ({ id: x.id, name: x.name, token: !!x.token, actor: !!x.actor, disposition: x.token?.disposition ?? null, uuid: x.actor?.uuid ?? null })) };
  },
  /** Knock a body down: the tracker's own defeat toggle (the combatant and the status), or a hit-point write. */
  defeat: async ({ combatId, combatantId, how }) => {
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    if (!c) return { found: false };
    if (how === "hp") await c.token.actor.update({ "system.hp.value": 0 });
    else {
      await c.update({ defeated: true });
      await c.actor?.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, { overlay: true, active: true });
    }
    return { found: true, name: c.name, isDefeated: !!c.isDefeated, defeatedField: !!c.defeated, hp: c.token?.actor?.system?.hp?.value ?? null };
  },
  /** Show the combat in the tracker on this seat, and say whether End Combat is on it. */
  view: async ({ combatId }) => {
    const H = globalThis.__sw;
    const combat = game.combats.get(combatId);
    try { ui.sidebar.changeTab("combat", "primary"); } catch { /* the tab may already be showing */ }
    await ui.combat.render({ combat, force: true });
    for (let n = 0; n < 40 && !ui.combat.element?.querySelector?.("li.combatant"); n++) await H.sleep(150);
    return { viewed: ui.combat.viewed?.id ?? null, rows: ui.combat.element?.querySelectorAll?.("li.combatant").length ?? 0, endButton: !!ui.combat.element?.querySelector?.("[data-action='endCombat']"), actions: [...(ui.combat.element?.querySelectorAll?.(".combat-controls [data-action], footer [data-action]") ?? [])].map((b) => b.dataset.action) };
  },
  showChat: async () => { try { ui.sidebar.changeTab("chat", "primary"); } catch { /* already showing */ } await globalThis.__sw.sleep(300); return true; },
  dialogActions: async () => [...document.querySelectorAll("dialog [data-action], .application.dialog [data-action]")].map((b) => b.dataset.action),
  combatGone: async ({ combatId }) => !!(await globalThis.__sw.poll(() => !game.combats.get(combatId), { tries: 60, every: 250 })),

  /* ---- Finding and clicking a control ---------------------------------- */
  locate: async ({ scope, potId, sel, nth = 0 }) => {
    const H = globalThis.__sw;
    const root = scope === "sheet" ? H.root(H.sheet(potId)) : document;
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
    const H = globalThis.__sw;
    if (!H.target) return false;
    H.target.click();
    return true;
  },

  /* ---- The card, the pot and the bodies --------------------------------- */
  /** The search card of a fight: its message, as this seat holds and renders it. */
  card: async ({ combatId, messageId = null }) => {
    const H = globalThis.__sw;
    const m = messageId ? game.messages.get(messageId) : game.messages.find((x) => x.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId);
    const all = game.messages.filter((x) => x.flags?.["acks-extras"]?.treasureSearch?.combatId === combatId).length;
    const li = m ? document.querySelector(`[data-message-id='${m.id}']`) : null;
    const flag = m?.flags?.["acks-extras"]?.treasureSearch ?? null;
    return {
      inCollection: !!m,
      messages: all,
      id: m?.id ?? null,
      uuid: m?.uuid ?? null,
      visible: m ? !!m.visible : null,
      rendered: !!li,
      stagedPot: flag?.stagedPot ?? null,
      fallen: (flag?.fallen ?? []).map((e) => ({ name: e.name, goods: e.goods?.length ?? 0, letter: e.letter ?? null, actorUuid: e.actorUuid })),
      rows: [...(li?.querySelectorAll(".acks-extras-treasure-search__list > li") ?? [])].map((r) => ({
        name: H.text(r.querySelector(".acks-extras-treasure-search__name")),
        items: H.text(r.querySelector(".acks-extras-treasure-search__items")),
        letter: H.text(r.querySelector(".acks-extras-treasure-search__letter")),
      })),
      note: H.text(li?.querySelector(".acks-extras-treasure-search__note")),
      button: H.text(li?.querySelector("[data-action='stagePot']")),
    };
  },
  /** Any search card at all in this seat's chat log, by DOM. */
  anySearchCardInLog: async () => document.querySelectorAll(".acks-extras-treasure-search").length,
  /** Mark the sheets open now, so the next new pot sheet is found by difference. */
  armSheets: async () => {
    const H = globalThis.__sw;
    H.before = new Set(foundry.applications.instances.values());
    H.potsBefore = H.pots().map((c) => c.id);
    return { pots: H.potsBefore.length };
  },
  awaitNewSheet: async () => {
    const H = globalThis.__sw;
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !H.before.has(a) && a.rendered && a.constructor.name === "PotSheet") ?? null, { tries: 60, every: 250 });
    if (!app) return null;
    H.opened.push(app);
    await H.sleep(500);
    return { potId: app.document.id, uuid: app.document.uuid, name: app.document.name };
  },
  /** How many pots stand now and how many are new since `armSheets`. */
  potCount: async () => {
    const H = globalThis.__sw;
    const now = H.pots().map((c) => c.id);
    return { now: now.length, fresh: now.filter((id) => !(H.potsBefore ?? []).includes(id)).length };
  },
  sheetOpenFor: async ({ potId }) => {
    const H = globalThis.__sw;
    const s = H.sheet(potId);
    return { rendered: !!s?.rendered, sameInstance: H.opened.includes(s) };
  },
  waitSheet: async ({ potId }) => {
    const H = globalThis.__sw;
    const app = await H.poll(() => { const s = H.sheet(potId); return s?.rendered && H.root(s)?.querySelector("li[data-card-id], .acks-extras-treasure__empty") ? s : null; }, { tries: 60, every: 250 });
    await H.sleep(300);
    return { rendered: !!app };
  },
  stage: async ({ potId }) => {
    const H = globalThis.__sw;
    const pile = H.pile(potId);
    if (!pile) return { gone: true };
    const f = pile.getFlag("acks-extras", "treasure") ?? {};
    return {
      gone: false,
      name: pile.name,
      phase: f.phase ?? null,
      order: f.order ?? [],
      messageId: f.messageId ?? null,
      origin: f.origin ?? null,
      cards: pile.cards.contents.map((c) => {
        const t = c.getFlag("acks-extras", "card") ?? {};
        return { id: c.id, face: c.face ?? null, pool: t.pool ?? null, label: t.label ?? "", claimedBy: t.claimedBy ?? null, sourceName: t.source?.data?.name ?? null };
      }),
    };
  },
  waitPot: async ({ potId, until }) => {
    const H = globalThis.__sw;
    const met = () => {
      const pile = H.pile(potId);
      const f = pile?.getFlag("acks-extras", "treasure") ?? {};
      if (until === "open") return f.phase === "open";
      if (until === "takenOff") return f.origin?.takenOff === true;
      if (until === "cards") return !!pile && pile.cards.size > 0;
      return false;
    };
    return { met: !!(await H.poll(met, { tries: 60, every: 250 })) };
  },
  /** The names a body (an actor or an unlinked token's actor, by uuid) carries, or its absence. */
  body: async ({ actorUuid }) => {
    let doc = null;
    try { doc = fromUuidSync(actorUuid); } catch { doc = null; }
    const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
    return { exists: !!actor, items: actor ? actor.items.map((i) => i.name).sort() : [] };
  },
  /** Poll a body until its item names satisfy `gone` (names that must be absent) and `kept` (names that must be present). */
  waitBody: async ({ actorUuid, gone, kept }) => {
    const H = globalThis.__sw;
    const read = () => {
      let doc = null;
      try { doc = fromUuidSync(actorUuid); } catch { doc = null; }
      const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
      const names = actor ? actor.items.map((i) => i.name) : [];
      H.lastBody = { exists: !!actor, names: [...names].sort() };
      return actor && gone.every((n) => !names.includes(n)) && kept.every((n) => names.includes(n)) ? names.sort() : null;
    };
    const names = await H.poll(read, { tries: 40, every: 250 });
    return { met: !!names, names: names ?? [], last: H.lastBody ?? null };
  },
  /** For each card of an origin's `carried`: the card's own name, the body's item the map points at, and that item's name. */
  carriedNames: async ({ potId }) => {
    const pile = globalThis.__sw.pile(potId);
    const carried = pile?.getFlag("acks-extras", "treasure")?.origin?.carried ?? {};
    return Object.entries(carried).map(([cardId, ref]) => {
      let doc = null;
      try { doc = fromUuidSync(ref.actorUuid); } catch { doc = null; }
      const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
      return { card: pile.cards.get(cardId)?.getFlag("acks-extras", "card")?.source?.data?.name ?? null, bodyName: actor?.name ?? null, item: actor?.items.get(ref.itemId)?.name ?? null };
    });
  },
  tokenExists: async ({ sceneId, tokenId }) => !!game.scenes.get(sceneId)?.tokens.get(tokenId),

  /* ---- The Player seat's side ------------------------------------------- */
  /** The doorway of a pot, as this seat's messages and chat log hold it. */
  doorFor: async ({ uuid }) => {
    const ms = game.messages.filter((m) => m.flags?.["acks-extras"]?.treasure?.uuid === uuid);
    return { messages: ms.length, ids: ms.map((m) => m.id), rendered: ms.filter((m) => !!document.querySelector(`[data-message-id='${m.id}'] .acks-extras-treasure-door`)).length };
  },
  relay: async ({ potId, op, cardId, actorUuid }) => {
    const H = globalThis.__sw;
    const payload = { potId, op, cardId };
    if (actorUuid !== undefined) payload.actorUuid = actorUuid;
    const r = await H.race(H.S.executeAsGM("treasurePot", payload), 25000);
    return r === undefined ? { none: true } : r;
  },
  actorRows: async ({ actorId }) => (game.actors.get(actorId)?.items ?? []).map((i) => ({ id: i.id, uuid: i.uuid, name: i.name })),

  closeAll: async () => {
    const H = globalThis.__sw;
    let n = 0;
    for (const app of H?.opened ?? []) { try { await app.close({ force: true, animate: false }); n++; } catch { /* already closed */ } }
    if (H) H.opened = [];
    return n;
  },
  drain: async () => ({ errors: globalThis.__sw.errors.slice() }),
  restore: async () => {
    const H = globalThis.__sw;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
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
const t = (api, key, data) => run(api, P.t, { key, data });
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.treasure && !!ui.combat`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** A CDP session on the seat's page: the boot recorder, and the real pointer. */
async function cdp(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((x) => x.type === "page" && x.url.startsWith(origin));
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
async function record(port, label, api) {
  const s = await cdp(port);
  await s.send("Page.enable");
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await s.send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  s.close();
  return seconds;
}
const idOf = (fx) => fx.id ?? String(fx.uuid).split(".").pop();

const clicks = { real: 0, scripted: 0 };
/** Press a control with a real pointer when its centre is the control, else `click()` and say so. */
async function press(api, port, spec, label) {
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

let gm = null;
let player = null;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 500_000);
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
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  const seatG = await run(gm, P.install, { lang: LANG });
  const seatP = await run(player, P.install, { lang: LANG });
  if (!seatG.isGM || !seatG.activeGMIsSelf) blocked("the GM seat is not the active GM: another GM client holds it");
  if (!seatG.primary) blocked("the GM seat's client is not the primary GM (isPrimaryGM is false): its deleteCombat hook would not record the fight, and a synthetic hook call is not the trigger");
  if (seatP.isGM || seatP.role > 2) blocked("the player seat is not a player");
  if (!seatP.activeGM || !seatP.socketlib) blocked("the player seat cannot reach a GM client");
  check("the GM seat is the active GM and the primary GM, and the player seat is a player with a GM to reach", seatG.isGM && seatG.activeGMIsSelf && seatG.primary && !seatP.isGM && seatP.activeGM && seatP.socketlib, { gm: seatG.role, player: seatP.role, primary: seatG.primary });
  for (const [key, c] of Object.entries({ gm: seatG, player: seatP })) {
    const phases = c.boot?.phases ?? [];
    const errors = c.boot?.errors ?? [];
    const naming = errors.filter((e) => /treasure|search|pot-sheet|pot-relay|pot-logic|doorway|\/pot\.mjs|hoard/i.test(e.text));
    note(`${key}: errors recorded from load through ready (any text)`, errors.length);
    check(`${key}: init, setup and ready ran and no error names a treasure file`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && naming.length === 0 && c.treasure, { phases, naming: naming.length, api: c.treasure });
  }

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const monster = (name, items, extra = {}) => ({ name, type: "monster", items, prototypeToken: { actorLink: false, disposition: -1 }, ...extra });
  const fxScene = await gm.fixture(MARKS.scene, "Scene", { name: "QA Search Scene", width: 1200, height: 800, grid: { size: 100 } });
  const fxHostile = await gm.fixture(MARKS.hostile, "Actor", monster(NAMES.hostile, GOODS.hostile, { system: { details: { treasure: { type: LETTER } } } }));
  const fxHostile2 = await gm.fixture(MARKS.hostile2, "Actor", monster(NAMES.hostile2, GOODS.hostile2));
  const fxFriend = await gm.fixture(MARKS.friend, "Actor", { name: NAMES.friend, type: "character", items: GOODS.friend, prototypeToken: { actorLink: false, disposition: 1 } });
  const fxPlayer = await gm.fixture(MARKS.player, "Actor", { name: NAMES.player, type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 3 } });
  const ids = { hostile: idOf(fxHostile), hostile2: idOf(fxHostile2), friend: idOf(fxFriend), player: idOf(fxPlayer) };
  const shaped = await run(gm, P.shape, { ids, want: GOODS, letter: LETTER, playerId });
  const nameSets = shaped.got ?? {};
  const namesOf = (k) => GOODS[k].map((i) => i.name).sort();
  check("the kept fixtures stand in the shape the steps start from: each body carries its goods once, the first a letter and no linked table, the player's character is the Player seat's", shaped.ok && ["hostile", "hostile2", "friend"].every((k) => nameSets[k] && !nameSets[k].dup && namesOf(k).every((n) => nameSets[k].names.includes(n))) && shaped.letter === LETTER && shaped.tableBlank && shaped.playerOwns, shaped);
  check("the Player seat sees every fixture actor", await run(player, P.sees, { ids }));

  section("Steps 1 and 2. a real fight, ended by the tracker");
  const places = { hostile: [100, 100], hostile2: [300, 100], friend: [500, 100] };
  const toks = {};
  for (const [key, [x, y]] of Object.entries(places)) {
    const tok = await gm.create("Token", { name: NAMES[key], actorId: ids[key], actorLink: false, x, y, disposition: key === "friend" ? 1 : -1 }, { parent: fxScene.uuid });
    made.push(tok.uuid);
    toks[key] = tok;
  }
  const combat = await gm.create("Combat", { scene: null, active: false });
  made.push(combat.uuid);
  const combatId = idOf(combat);
  const rows = {};
  for (const key of Object.keys(places)) {
    const row = await gm.create("Combatant", { tokenId: idOf(toks[key]), sceneId: idOf(fxScene), actorId: ids[key] }, { parent: combat.uuid });
    made.push(row.uuid);
    rows[key] = idOf(row);
  }
  await run(gm, P.showChat);
  const view0 = await run(gm, P.view, { combatId });
  if (view0.viewed !== combatId) throw new Error("the tracker does not show this run's combat; Begin Combat is not pressed");
  const beginPress = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='startCombat'], .combat-tracker [data-action='startCombat']" }, "the tracker's Begin Combat");
  let fight = await run(gm, P.startFight, { combatId });
  for (let n = 0; n < 16 && !fight.started; n++) { await sleep(250); fight = await run(gm, P.startFight, { combatId }); }
  if (!fight.started) {
    note("Begin Combat did not start the combat (a real press was found: " + beginPress.found + "); the round is written instead", beginPress);
    fight = await run(gm, P.startFight, { combatId, start: "update" });
  }
  check("a combat of three combatants began: each resolves to its token and actor, the two bodies hostile and the friend friendly", fight.found && fight.started && fight.rows?.length === 3 && fight.rows.every((r) => r.token && r.actor) && fight.rows.filter((r) => r.disposition === -1).length === 2 && fight.rows.filter((r) => r.disposition === 1).length === 1, fight);
  const d1 = await run(gm, P.defeat, { combatId, combatantId: rows.hostile, how: "toggle" });
  const d2 = await run(gm, P.defeat, { combatId, combatantId: rows.hostile2, how: "hp" });
  const d3 = await run(gm, P.defeat, { combatId, combatantId: rows.friend, how: "toggle" });
  check("the first body and the friend are marked defeated as the tracker marks them, the second body is at 0 hit points", d1.isDefeated && d1.defeatedField && d3.isDefeated && d2.hp === 0 && !d2.isDefeated, { d1: d1.isDefeated, d2hp: d2.hp, d3: d3.isDefeated });

  await run(gm, P.showChat);
  const viewed = await run(gm, P.view, { combatId });
  note("the tracker", viewed);
  check("the GM's tracker shows this run's combat, and End Combat is on it", viewed.viewed === combatId && viewed.endButton, viewed);
  if (viewed.viewed !== combatId || !viewed.endButton) throw new Error("the tracker does not show this run's combat with an End Combat button; nothing is pressed");
  const endPress = await press(gm, PORTS.gm, { scope: "doc", sel: "#combat [data-action='endCombat'], .combat-tracker [data-action='endCombat']" }, "the tracker's End Combat");
  let yes = { found: false };
  if (endPress.found) {
    await sleep(600);
    yes = await press(gm, PORTS.gm, { scope: "doc", sel: "dialog [data-action='yes'], .application.dialog [data-action='yes']" }, "End Combat's confirm");
    if (!yes.found) note("the confirm's yes button was not found; the dialog offers", await run(gm, P.dialogActions));
  }
  const gone = await run(gm, P.combatGone, { combatId });
  check("End Combat and its confirm were pressed and the combat is gone from the world", endPress.found && yes.found && gone, { end: endPress, yes, gone });

  // The hook's card: the message whose flag names this combat.
  let card = null;
  for (let n = 0; n < 40; n++) { card = await run(gm, P.card, { combatId }); if (card.inCollection && card.rendered) break; await sleep(250); }
  if (card?.id) made.push(gm.track(card.id, "ChatMessage"));
  const tItems = (n) => t(gm, "search.items", { n });
  const tLetter = await t(gm, "search.letter", { letter: LETTER });
  const tNote = await t(gm, "search.letterNote");
  const tStage = await t(gm, "search.stage");
  const rowOf = (name) => card.rows.find((r) => r.name === name);
  const fallenNames = card.fallen.map((f) => f.name).sort();
  check("the real deleteCombat hook posted one Search the fallen card on the Judge seat, once", card.inCollection && card.messages === 1 && card.rendered && card.visible, { messages: card.messages, rendered: card.rendered });
  check("it lists both hostile bodies and not the defeated friend", card.rows.length === 2 && !!rowOf(NAMES.hostile) && !!rowOf(NAMES.hostile2) && !rowOf(NAMES.friend) && fallenNames.join() === [NAMES.hostile, NAMES.hostile2].sort().join(), { rows: card.rows.length, fallen: fallenNames.length });
  check("each row counts its carried goods (two, the natural weapon not counted; one) and only the first shows its letter", rowOf(NAMES.hostile)?.items === (await tItems(2)) && rowOf(NAMES.hostile2)?.items === (await tItems(1)) && rowOf(NAMES.hostile)?.letter === tLetter && rowOf(NAMES.hostile2)?.letter === "", { first: rowOf(NAMES.hostile)?.items === (await tItems(2)), second: rowOf(NAMES.hostile2)?.items === (await tItems(1)), letter: rowOf(NAMES.hostile)?.letter === tLetter });
  check("it carries the note that letters are dealt when the treasure tables are imported, and the stage button reads Stage", card.note === tNote && card.button === tStage, { note: card.note === tNote, button: card.button === tStage });
  const cardP = await run(player, P.card, { combatId, messageId: card.id });
  const logP = await run(player, P.anySearchCardInLog);
  note("the Player seat holds the message in its collection (a whisper to the Judges is not delivered to it)", cardP.inCollection);
  check("the Player seat sees no search card: not visible to it, not in its chat log", !cardP.visible && !cardP.rendered && logP === 0, { collection: cardP.inCollection, visible: cardP.visible, log: logP });

  section("Step 3. stage a pot on the card");
  await run(gm, P.showChat);
  const armed = await run(gm, P.armSheets);
  const stagePress = await press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${card.id}'] [data-action='stagePot']` }, "the card's stage button");
  const opened = await run(gm, P.awaitNewSheet);
  if (!opened) throw new Error("no pot sheet opened on the GM seat after the card's stage button was pressed");
  const potId = opened.potId;
  made.push(gm.track(opened.uuid, "Cards"));
  const w3 = await run(gm, P.waitPot, { potId, until: "cards" });
  await sleep(1200);
  const s3 = await run(gm, P.stage, { potId });
  const origin3 = s3.origin ?? {};
  const carried = origin3.carried ?? {};
  const potsNow = await run(gm, P.potCount);
  const bodies = [card.fallen[0], card.fallen[1]];
  const goodsNames = [...GOODS.hostile.slice(0, 2), ...GOODS.hostile2].map((i) => i.name).sort();
  const bodyA = await run(gm, P.body, { actorUuid: card.fallen.find((f) => f.name === NAMES.hostile).actorUuid });
  const bodyB = await run(gm, P.body, { actorUuid: card.fallen.find((f) => f.name === NAMES.hostile2).actorUuid });
  const cardRefs = Object.entries(carried);
  const pairs = await run(gm, P.carriedNames, { potId });
  check("every carried entry points at the item the card was made from: the card's name is the name of the item on the body it maps to", pairs.length === 3 && pairs.every((p) => p.card !== null && p.card === p.item), pairs);
  check("the button opened a pot window in staging: its pile flag reads phase staging", stagePress.found && s3.phase === "staging" && w3.met, { press: stagePress, phase: s3.phase });
  check("the pot holds three cards, the bodies' goods (an item, a coin, an item) and no card for the natural weapon, every card face down", s3.cards.length === CARD_GOODS && s3.cards.map((c) => c.sourceName).sort().join() === goodsNames.join() && s3.cards.every((c) => c.face === null), { cards: s3.cards.length, names: s3.cards.map((c) => c.sourceName === null ? "?" : "named").length });
  check("origin.kind is combat, takenOff is false, and carried maps each card id to the body's actor uuid and item id", origin3.kind === "combat" && origin3.takenOff === false && origin3.combatId === combatId && cardRefs.length === 3 && cardRefs.every(([id, ref]) => s3.cards.some((c) => c.id === id) && bodies.some((b) => b.actorUuid === ref.actorUuid) && !!ref.itemId), { kind: origin3.kind, takenOff: origin3.takenOff, carried: cardRefs.length });
  check("the bodies still carry every item, the natural weapon among them", GOODS.hostile.every((i) => bodyA.items.includes(i.name)) && GOODS.hostile2.every((i) => bodyB.items.includes(i.name)), { a: bodyA.items.length, b: bodyB.items.length });
  const afterStage = await run(gm, P.card, { combatId, messageId: card.id });
  const tOpenStaged = await t(gm, "search.open");
  check("the card names the staged pot and its button now reads 'Open the staged pot'", afterStage.stagedPot === opened.uuid && afterStage.button === tOpenStaged, { staged: afterStage.stagedPot === opened.uuid, button: afterStage.button === tOpenStaged });
  await run(gm, P.armSheets);
  await run(gm, P.closeAll);
  const again = await press(gm, PORTS.gm, { scope: "doc", sel: `[data-message-id='${card.id}'] [data-action='stagePot']` }, "the card's open-staged-pot button");
  const sheetAgain = await run(gm, P.waitSheet, { potId });
  const potsAfter = await run(gm, P.potCount);
  check("pressing the card again opened the same pot's window and made no second pot", again.found && sheetAgain.rendered && potsAfter.fresh === 0 && potsAfter.now === potsNow.now, { again: again.found, rendered: sheetAgain.rendered, fresh: potsAfter.fresh });

  section("Staging: a card removed");
  const coinCard = s3.cards.find((c) => c.pool === "coins");
  const removePress = await press(gm, PORTS.gm, { scope: "sheet", potId, sel: `li[data-card-id='${coinCard?.id}'] [data-action='removeCard']` }, "Remove on the coin card");
  let s3b = null;
  for (let n = 0; n < 30; n++) { s3b = await run(gm, P.stage, { potId }); if (s3b.cards.length === CARD_GOODS - 1) break; await sleep(250); }
  check("Remove took the coin card out of the pot in staging", removePress.found && s3b.cards.length === CARD_GOODS - 1 && !s3b.cards.some((c) => c.id === coinCard?.id) && !s3b.order.includes(coinCard?.id), { cards: s3b.cards.length });

  section("Step 5. delete one body's token before Open");
  const bodyBUuid = card.fallen.find((f) => f.name === NAMES.hostile2).actorUuid;
  const bauble = Object.entries(carried).find(([, ref]) => ref.actorUuid === bodyBUuid);
  const swept = await gm.sweepTracked({ only: [toks.hostile2.uuid] });
  note("the second body's token is deleted by its tracked id", swept);
  const tokGone = !(await run(gm, P.tokenExists, { sceneId: idOf(fxScene), tokenId: idOf(toks.hostile2) }));
  const bodyBGone = await run(gm, P.body, { actorUuid: bodyBUuid });
  const sGone = await run(gm, P.stage, { potId });
  check("the token is gone and its body no longer resolves, while its card stands in the pot", tokGone && !bodyBGone.exists && !!bauble && sGone.cards.some((c) => c.id === bauble[0]) && sGone.order.includes(bauble[0]), { token: tokGone, body: bodyBGone.exists, card: !!bauble });

  section("Step 6. Open to the table: the take-off");
  const potLook = await run(player, P.doorFor, { uuid: opened.uuid });
  check("before Open the Player seat has no doorway for this pot", potLook.messages === 0, potLook);
  const openPress = await press(gm, PORTS.gm, { scope: "sheet", potId, sel: "aside [data-action='openTable']" }, "Open to the table");
  const wOpen = await run(gm, P.waitPot, { potId, until: "open" });
  const wTake = await run(gm, P.waitPot, { potId, until: "takenOff" });
  const bodyAKept = [GOODS.hostile[1].name, GOODS.hostile[2].name];
  const wBody = await run(gm, P.waitBody, { actorUuid: card.fallen.find((f) => f.name === NAMES.hostile).actorUuid, gone: [GOODS.hostile[0].name], kept: bodyAKept });
  const s6 = await run(gm, P.stage, { potId });
  if (s6.messageId) made.push(gm.track(s6.messageId, "ChatMessage"));
  check("Open to the table was pressed: the phase is open and origin.takenOff is true", openPress.found && wOpen.met && wTake.met && s6.phase === "open" && s6.origin?.takenOff === true, { phase: s6.phase, takenOff: s6.origin?.takenOff });
  check("the surviving body no longer carries the item that is a card, still carries the natural weapon, and still carries the coin whose card was removed in staging", wBody.met, wBody);
  check("the deleted body's card is still in the pot, face down, unclaimed", !!bauble && s6.cards.some((c) => c.id === bauble[0] && c.face === null && !c.claimedBy) && s6.order.includes(bauble[0]), { card: !!bauble });
  const doorP = await run(player, P.doorFor, { uuid: opened.uuid });
  for (const id of doorP.ids) made.push(gm.track(id, "ChatMessage"));
  check("the Player seat sees the doorway only now: one card, rendered", doorP.messages === 1 && doorP.rendered === 1, doorP);

  section("The deleted body's card still claims");
  const rowsBefore = await run(player, P.actorRows, { actorId: ids.player });
  const flipB = await run(player, P.relay, { potId, op: "flip", cardId: bauble?.[0] });
  const claimB = await run(player, P.relay, { potId, op: "claim", cardId: bauble?.[0], actorUuid: fxPlayer.uuid });
  const rowsAfter = await run(player, P.actorRows, { actorId: ids.player });
  const fresh = rowsAfter.filter((r) => !rowsBefore.some((b) => b.id === r.id));
  for (const r of fresh) made.push(gm.track(r.uuid, "Item"));
  check("a flip and a Take of that card through the relay from the Player seat deliver the item to the seat's own character, from the snapshot", flipB.ok === true && claimB.ok === true && fresh.some((r) => r.name === GOODS.hostile2[0].name), { flip: flipB, claim: claimB, fresh: fresh.length });

  section("console");
  for (const [key, api] of [["gm", gm], ["player", player]]) {
    const drained = await run(api, P.drain);
    check(`${key}: no console error over the walk`, !drained.errors.length, drained.errors.slice(0, 3));
  }
  note("clicks (real pointer presses / pressed with click())", clicks);
  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (player) {
    try { await run(player, P.closeAll); } catch {}
    try { note("restored (player)", await run(player, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  if (gm) {
    try { await run(gm, P.closeAll); } catch {}
    try { note("restored (gm)", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
    // Only the run's own ids: the tokens, the combat, the search card, the pot, the doorway, the rows the claim made. Kept fixtures stay.
    try {
      note("swept (the run's own ids)", await gm.sweepTracked({ only: made.filter((uuid) => gm.tracked().some((e) => e.uuid === uuid)) }));
    } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const marker of Object.values(MARKS)) console.log(`fixture kept: ${marker}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
