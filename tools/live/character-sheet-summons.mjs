/**
 * Live walk, character-sheet-summons: a player summons creatures. Walks
 * docs/character-sheet/TESTING.md "Summons from a Player seat" on the GM and
 * Player seats: the party cell's Summon… opens the prompt, core's
 * click-to-place takes each preview from a real mouse click on the canvas, the
 * GM's client makes unlinked tokens the Player owns through their delta, with
 * one cast record across a summoning and one GM-only world copy per creature;
 * the Player moves and wounds a summon; a right click cancels; a character the
 * Player does not own offers no Summon… and its API refuses; Dismiss asks
 * first; a token bound by hand survives Dismiss all and is let go by Release.
 * Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `summons/scene`, `summons/summoner` (a
 * character the Player seat owns, with one spell), its token
 * `summons/summoner-token`, `summons/stranger` (a character the Player seat
 * only observes), `summons/spike-source` (a monster actor) and its unlinked
 * token `summons/bindable`, owned by the Player through its delta. The run's
 * own documents — the summoned tokens and, where none stood before, the
 * creature's world copy — are tracked and swept by uuid. A paused world is
 * unpaused for the run and paused again in the finally. Every figure printed
 * is a boolean or a count; no creature's name leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
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

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__smBoot = { phase: "load", phases: [], errors: [] });
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

/** Where each summoning is clicked, in scene pixels from the scene's corner (the field is 1400 by 900). */
const CELLS = { cast: [[450, 350], [650, 350], [850, 350]], again: [450, 550], cancel: [650, 550], second: [650, 750] };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__sm = globalThis.__sm ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => {
      const el = app?.element;
      return el?.nodeType === 1 ? el : (el?.[0] ?? null);
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.warn = ui.notifications.warn;
      ui.notifications.warn = function (msg, ...rest) { H.warns.push(String(msg)); return H.warn.call(this, msg, ...rest); };
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, boot: globalThis.__smBoot ?? null };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  pause: async ({ paused }) => {
    if (game.paused !== paused) game.togglePause(paused, { broadcast: true });
    await new Promise((r) => setTimeout(r, 800));
    return game.paused;
  },
  drain: async () => {
    const H = globalThis.__sm;
    const out = { errors: H.errors.slice(), warns: H.warns.slice() };
    H.errors.length = 0;
    H.warns.length = 0;
    return out;
  },
  spellOf: async ({ actorId }) => game.actors.get(actorId)?.items.find((i) => i.type === "spell")?.id ?? null,
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
  firstCreature: async () => {
    const { summonShelves } = await import("/modules/acks-extras/scripts/lib/summons.mjs");
    const shelves = summonShelves();
    return shelves[0]?.entries?.[0]?.uuid ?? null;
  },
  /** The world copies of a source: their uuid, and whether any player holds a level on them. */
  copiesOf: async ({ sourceUuid }) =>
    game.actors
      .filter((a) => a.getFlag("acks-extras", "summonCopy")?.sourceUuid === sourceUuid)
      .map((a) => ({
        uuid: a.uuid,
        noDefault: (a.ownership?.default ?? 0) === 0,
        // Core makes a document's creator its owner; a GM seat holding a level is no grant.
        playerLevels: Object.entries(a.ownership ?? {}).filter(([id, level]) => id !== "default" && level > 0 && !game.users.get(id)?.isGM).length,
        folder: a.folder?.name ?? null,
        folderId: a.folder?.id ?? null,
      })),
  summonTokens: async ({ sceneId, summonerUuid }) =>
    [...game.scenes.get(sceneId).tokens]
      .filter((t) => t.actor?.getFlag("acks-extras", "summonedBy") === summonerUuid)
      .map((t) => ({ uuid: t.uuid, x: t.x, record: t.actor.getFlag("acks-extras", "summon") ?? null })),
  /** Open the actor's sheet and its party cell; the menu's entries, as their labels. */
  openMenu: async ({ actorId }) => {
    const H = globalThis.__sm;
    const sheet = game.actors.get(actorId)?.sheet;
    if (!sheet) return { sheet: false, items: [] };
    if (!sheet.rendered) { await sheet.render(true); await H.sleep(1500); }
    document.querySelectorAll(".acks-extras-frame__menu").forEach((m) => m.remove());
    const button = H.root(sheet)?.querySelector('[data-action="partyMenu"]');
    if (!button) return { sheet: true, cell: false, items: [] };
    button.click();
    await H.sleep(600);
    return { sheet: true, cell: true, items: [...document.querySelectorAll(".acks-extras-frame__menu-item")].map((b) => b.textContent.trim()) };
  },
  closeMenu: async () => { document.querySelectorAll(".acks-extras-frame__menu").forEach((m) => m.remove()); return true; },
  pick: async ({ label }) => {
    const H = globalThis.__sm;
    const b = [...document.querySelectorAll(".acks-extras-frame__menu-item")].find((x) => x.textContent.trim() === label);
    if (!b) return false;
    b.click();
    await H.sleep(900);
    return true;
  },
  /** Answer the Summon prompt and press Place on the map; then clear every framed window off the map. */
  fillPrompt: async ({ sourceUuid, count, spellId }) => {
    const H = globalThis.__sm;
    const form = await H.poll(() => [...document.querySelectorAll("form")].find((f) => f.elements?.source && f.elements?.count));
    if (!form) return { prompt: false };
    const listed = [...form.elements.source.options].some((o) => o.value === sourceUuid);
    if (listed) form.elements.source.value = sourceUuid;
    form.elements.count.value = String(count);
    if (form.elements.spell && spellId) form.elements.spell.value = spellId;
    const ok = form.querySelector('button[data-action="ok"]') ?? form.closest(".application")?.querySelector('button[data-action="ok"]');
    ok?.click();
    await H.sleep(500);
    // The sheet, and the User Configuration a seat with no character opens on
    // join, stand over the map; a user moves them aside before placing.
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    await H.sleep(500);
    return { prompt: true, listed, pressed: !!ok, spellField: !!form.elements.spell };
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    return true;
  },
  /**
   * Client points for scene cells. The view is panned back first: a controlled
   * token or a restored view position may have moved it since the scene was
   * viewed. Each point says whether the canvas itself is what lies under it.
   */
  pointsFor: async ({ cells }) => {
    const r = canvas.dimensions.sceneRect;
    canvas.pan({ x: r.x + r.width / 2, y: r.y + r.height / 2, scale: 0.5 });
    await new Promise((res) => setTimeout(res, 400));
    return cells.map(([cx, cy]) => {
      const p = canvas.clientCoordinatesFromCanvas({ x: r.x + cx, y: r.y + cy });
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      return { x, y, onCanvas: document.elementFromPoint(x, y) === canvas.app.view };
    });
  },
  worldTime: async () => game.time.worldTime,
  ownership: async ({ uuids }) => {
    const out = [];
    for (const uuid of uuids) {
      const t = await fromUuid(uuid);
      out.push({ unlinked: t.actorLink === false, owner: t.isOwner, actorOwner: !!t.actor?.isOwner, canUpdate: t.canUserModify(game.user, "update"), editable: !!t.actor?.sheet?.isEditable });
    }
    return out;
  },
  moveAndWound: async ({ uuid }) => {
    const t = await fromUuid(uuid);
    const x = t.x + canvas.grid.size;
    await t.update({ x }, { animate: false });
    const hp = Number(t.actor.system?.hp?.value) || 0;
    let written = true;
    try { await t.actor.update({ "system.hp.value": Math.max(0, hp - 1) }); } catch { written = false; }
    await new Promise((r) => setTimeout(r, 1200));
    return { x, hp, written };
  },
  readToken: async ({ uuid }) => {
    const t = await fromUuid(uuid);
    return t ? { x: t.x, hp: Number(t.actor?.system?.hp?.value) || 0 } : null;
  },
  answer: async ({ action }) => {
    const H = globalThis.__sm;
    const b = await H.poll(() => [...document.querySelectorAll(".application.dialog button, dialog button")].find((x) => x.dataset.action === action), { tries: 30 });
    if (!b) return false;
    b.click();
    await H.sleep(1200);
    return true;
  },
  /** Start a one-creature summoning through the API; its result lands on the page when the click places it. */
  startOne: async ({ actorId, sourceUuid }) => {
    const H = globalThis.__sm;
    H.one = null;
    acksExtras.lib.summons.placeSummons(game.actors.get(actorId), { sourceUuid, count: 1 }).then((r) => { H.one = r; });
    return true;
  },
  oneResult: async () => {
    const H = globalThis.__sm;
    return (await H.poll(() => H.one, { tries: 40, every: 200 })) ?? null;
  },
  directPlace: async ({ actorId, sourceUuid }) => acksExtras.lib.summons.placeSummons(game.actors.get(actorId), { sourceUuid, count: 1 }),
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
  restore: async () => {
    const H = globalThis.__sm;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.warn = H.warn;
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
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.summons`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** A CDP session on the seat's page, for the boot recorder and real mouse input. */
async function cdp(port) {
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
/** A real click on the seat's page: the pointer moves there first, so core's preview follows it. */
async function clickAt(port, { x, y }, button = "left") {
  const s = await cdp(port);
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
/** The uuids of what this run made: the summoned tokens and a copy it caused. The only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
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
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    const phases = c.boot?.phases ?? [];
    check(`${key}: init, setup and ready ran with no error recorded from before the first script`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && (c.boot?.errors ?? []).length === 0, { phases, errors: (c.boot?.errors ?? []).length });
  }
  // A paused world refuses a player's summons; the run unpauses it and the finally pauses it again.
  wasPaused = installed.paused;
  if (wasPaused) note("unpaused for the run", !(await run(gm, P.pause, { paused: false })));

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const scene = await gm.fixture("summons/scene", "Scene", {
    name: "QA Summoning Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 },
  });
  const summoner = await gm.fixture("summons/summoner", "Actor", {
    name: "QA Summoner", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 } },
    ownership: { default: 0, [playerId]: 3 }, items: [{ name: "QA Calling Word", type: "spell" }],
  });
  const stranger = await gm.fixture("summons/stranger", "Actor", {
    name: "QA Stranger", type: "character", prototypeToken: { actorLink: true }, ownership: { default: 0, [playerId]: 2 },
  });
  await gm.fixture("summons/summoner-token", "Token", { name: "QA Summoner", actorId: summoner.id, actorLink: true, x: 100, y: 100, width: 1, height: 1 }, { parent: scene.uuid });
  const spike = await gm.fixture("summons/spike-source", "Actor", { name: "QA Spike Source", type: "monster" });
  const bindable = await gm.fixture("summons/bindable", "Token", {
    name: "QA Bindable", actorId: spike.id, actorLink: false, x: 1100, y: 700, width: 1, height: 1, delta: { ownership: { [playerId]: 3 } },
  }, { parent: scene.uuid });
  const summonerUuid = `Actor.${summoner.id}`;
  const spellId = await run(gm, P.spellOf, { actorId: summoner.id });
  check("the summoner carries a spell to choose", !!spellId);
  check("the Player seat views the field without activating it", await run(player, P.view, { sceneId: scene.id }));
  const tokens = () => run(gm, P.summonTokens, { sceneId: scene.id, summonerUuid });

  section("start");
  const before = await tokens();
  check("the summoner has no summons on the field", before.length === 0, { n: before.length });
  if (before.length) throw new Error(`leftover summons on the field: ${before.map((t) => t.uuid).join(", ")}`);
  const creature = await run(player, P.firstCreature);
  check("the Player can open a monster compendium", !!creature);
  if (!creature) throw new Error("no monster compendium is open to the Player seat");
  const copiesBefore = await run(gm, P.copiesOf, { sourceUuid: creature });
  note("copies of the creature before the run", copiesBefore.length);
  await run(player, P.drain);

  section("1-2: summon three, owned through their delta");
  const m1 = await run(player, P.openMenu, { actorId: summoner.id });
  check("1: the party cell offers Summon…", m1.cell && m1.items.includes("Summon…"));
  await run(player, P.pick, { label: "Summon…" });
  const f1 = await run(player, P.fillPrompt, { sourceUuid: creature, count: 3, spellId });
  check("1: the prompt lists the creature and the spell, and Place on the map is pressed", f1.prompt && f1.listed && f1.spellField && f1.pressed, f1);
  const points = await run(player, P.pointsFor, { cells: CELLS.cast });
  check("1: every click point lies on the bare canvas", points.every((p) => p.onCanvas), points.map((p) => p.onCanvas));
  const worldTime = await run(player, P.worldTime);
  for (const p of points) await clickAt(PORTS.player, p);
  let placed = [];
  for (let n = 0; n < 40 && placed.length < 3; n++) { placed = await tokens(); if (placed.length < 3) await sleep(300); }
  for (const t of placed) await track(t.uuid, "Token");
  const d1 = await run(player, P.drain);
  check("1: three left clicks place three tokens, with no error and no warning", placed.length === 3 && !d1.errors.length && !d1.warns.length, { n: placed.length, errors: d1.errors.length, warns: d1.warns.length });
  if (placed.length !== 3) throw new Error("the summoning placed no cast; every later step reads its tokens");
  const owned = await run(player, P.ownership, { uuids: placed.map((t) => t.uuid) });
  check("2: each token is unlinked, and the Player owns it and its actor and may update it", owned.every((o) => o.unlinked && o.owner && o.actorOwner && o.canUpdate), owned);
  const casts = new Set(placed.map((t) => t.record?.castId));
  check("2: one cast id across the three, with the source, the spell and the world time", casts.size === 1 && !casts.has(undefined) && placed.every((t) => t.record?.sourceUuid === creature && t.record?.spellId === spellId && t.record?.at === worldTime), { casts: casts.size });

  section("3: one GM-only world copy per creature");
  const copies = await run(gm, P.copiesOf, { sourceUuid: creature });
  if (!copiesBefore.length) for (const c of copies) await track(c.uuid, "Actor");
  check("3: one copy, with no default level and no player's level, in a folder named Summoned", copies.length === 1 && copies[0].noDefault && copies[0].playerLevels === 0 && copies[0].folder === "Summoned", copies.map(({ noDefault, playerLevels, folder }) => ({ noDefault, playerLevels, summonedFolder: folder === "Summoned" })));
  const hidden = await player.eval(`(() => { const a = fromUuidSync(${JSON.stringify(copies[0]?.uuid ?? "")}); const f = game.folders.get(${JSON.stringify(copies[0]?.folderId ?? "")}); return JSON.stringify({ actor: !!a?.visible, folder: !!f?.visible }); })()`).then(JSON.parse);
  check("3: the Player's sidebar shows neither the copy nor its folder", !hidden.actor && !hidden.folder, hidden);
  const summonOne = async (cell) => {
    await run(player, P.clearWindows);
    const [pt] = await run(player, P.pointsFor, { cells: [cell] });
    await run(player, P.startOne, { actorId: summoner.id, sourceUuid: creature });
    await sleep(900);
    await clickAt(PORTS.player, pt);
    const result = await run(player, P.oneResult);
    for (const uuid of result?.tokenUuids ?? []) await track(uuid, "Token");
    return { result, onCanvas: pt.onCanvas };
  };
  const again = await summonOne(CELLS.again);
  check("3: the same creature summoned again still has one copy", again.result?.ok && (await run(gm, P.copiesOf, { sourceUuid: creature })).length === 1, { ok: again.result?.ok ?? null, onCanvas: again.onCanvas });

  section("4: the Player plays a summon");
  const moved = await run(player, P.moveAndWound, { uuid: placed[0].uuid });
  const seen = await run(gm, P.readToken, { uuid: placed[0].uuid });
  check("4: the Player's move and hit-point write land on the GM seat, and the sheet is editable", seen?.x === moved.x && moved.written && seen?.hp === Math.max(0, moved.hp - 1) && owned[0].editable, { moved: seen?.x === moved.x, wounded: seen?.hp === Math.max(0, moved.hp - 1), editable: owned[0].editable });

  section("5: a right click cancels");
  await run(player, P.drain);
  await run(player, P.openMenu, { actorId: summoner.id });
  await run(player, P.pick, { label: "Summon…" });
  const f5 = await run(player, P.fillPrompt, { sourceUuid: creature, count: 1, spellId: "" });
  const [cancelAt] = await run(player, P.pointsFor, { cells: [CELLS.cancel] });
  await clickAt(PORTS.player, cancelAt, "right");
  await sleep(1200);
  const after5 = await tokens();
  const d5 = await run(player, P.drain);
  check("5: no token is made, and no warning or error is shown", f5.prompt && after5.length === 4 && !d5.warns.length && !d5.errors.length, { n: after5.length, warns: d5.warns.length, errors: d5.errors.length });

  section("6: a character the Player does not own");
  const m6 = await run(player, P.openMenu, { actorId: stranger.id });
  await run(player, P.closeMenu);
  check("6: its party cell offers no Summon…", !m6.items.includes("Summon…"), { cell: !!m6.cell });
  const refused = await run(player, P.directPlace, { actorId: stranger.id, sourceUuid: creature });
  check("6: placeSummons resolves notOwner and makes nothing", refused?.ok === false && refused?.reason === "notOwner" && (await tokens()).length === 4, { reason: refused?.reason ?? null });
  await run(player, P.clearWindows);

  section("7: Dismiss asks first");
  const m7 = await run(player, P.openMenu, { actorId: summoner.id });
  const dismissThree = m7.items.find((l) => l.startsWith("Dismiss ") && l.endsWith("(3)"));
  check("7: the cell offers Dismiss for the cast of three, and Dismiss all with two casts standing", !!dismissThree && m7.items.includes("Dismiss all summons"));
  await run(player, P.pick, { label: dismissThree });
  const no = await run(player, P.answer, { action: "no" });
  check("7: No removes nothing", no && (await tokens()).length === 4);
  await run(player, P.openMenu, { actorId: summoner.id });
  await run(player, P.pick, { label: dismissThree });
  const yes = await run(player, P.answer, { action: "yes" });
  await sleep(1500);
  check("7: Yes removes the three; the other cast and the copy stay", yes && (await tokens()).length === 1 && (await run(gm, P.copiesOf, { sourceUuid: creature })).length === 1);

  section("8: a token bound by hand");
  await run(player, P.clearWindows);
  check("8: the Player controls the bindable token alone", await run(player, P.controlOnly, { tokenId: bindable.id }));
  const m8 = await run(player, P.openMenu, { actorId: summoner.id });
  const bind = m8.items.find((l) => l.startsWith("Bind "));
  check("8: the cell offers Bind for the controlled token", !!bind);
  if (bind) await run(player, P.pick, { label: bind });
  await sleep(800);
  check("8: the bound token names the summoner", (await run(gm, P.boundTo, { uuid: bindable.uuid })) === summonerUuid);
  // Dismiss all is offered from two casts up: a second one-creature cast joins the one left.
  const second = await summonOne(CELLS.second);
  check("8: a second cast is placed beside the one left", second.result?.ok === true, { onCanvas: second.onCanvas });
  const m8a = await run(player, P.openMenu, { actorId: summoner.id });
  check("8: Dismiss all is offered", m8a.items.includes("Dismiss all summons"));
  await run(player, P.pick, { label: "Dismiss all summons" });
  await run(player, P.answer, { action: "yes" });
  await sleep(1500);
  const after8 = await tokens();
  check("8: Dismiss all removes both casts and leaves the bound token", after8.length === 1 && after8[0].uuid === bindable.uuid, { n: after8.length });
  const m8b = await run(player, P.openMenu, { actorId: summoner.id });
  const release = m8b.items.find((l) => l.startsWith("Release"));
  check("8: Release is offered for the bound token", !!release);
  if (release) await run(player, P.pick, { label: release });
  await sleep(800);
  check("8: Release lets it go", (await run(gm, P.boundTo, { uuid: bindable.uuid })) == null);

  const pEnd = await run(player, P.drain);
  const gEnd = await run(gm, P.drain);
  check("no console error on either seat over the walk", !pEnd.errors.length && !gEnd.errors.length, { player: pEnd.errors.length, gm: gEnd.errors.length });
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's tokens and copy go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  if (gm && wasPaused) {
    try { note("paused again", await run(gm, P.pause, { paused: true })); } catch (err) { console.error("pause restore:", err?.message ?? err); }
  }
  console.log("fixtures kept: summons/scene, summons/summoner, summons/summoner-token, summons/stranger, summons/spike-source, summons/bindable");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
