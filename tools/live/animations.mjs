/**
 * Live walk, Automated Animations: docs/lib/TESTING.md "Automated Animations".
 * The world's module configuration gains Automated Animations, Sequencer and
 * JB2A, and the module's own listener is proven by what Sequencer draws: a hit
 * lands on the target and a miss off it, in melee and at range; a weapon with no
 * row of its own takes the kind of attack's default row; an unlinked creature's
 * attack reads; a whispered or blind attack plays with no result on every seat;
 * a hidden token plays nothing on any seat; the target is the one the throw was
 * made at; a spell plays as it reads; a Player's attack shows on both seats; and,
 * with Dice So Nice on, the effect waits for the dice. Machine values arrive
 * through ./_env.mjs; nothing here names a port, a world, a seat or a book.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the scene
 * `animations/scene`, viewed by each seat and never activated; the actors
 * `animations/attacker` (a character the Player seat owns), `animations/target`,
 * `animations/creature` and `animations/loose` (monsters, the last with no token
 * anywhere); the tokens `animations/attacker-token` and `animations/target-token`,
 * linked, and `animations/creature-token`, unlinked; the attacker's items
 * `animations/sword`, `animations/blade`, `animations/bow`, `animations/sling`,
 * `animations/knife` and `animations/missile`, the creature's `animations/maw` and
 * the loose actor's `animations/loose-sword`. The walk asserts the shape it needs at
 * the start of a section: ownership written whole, each weapon's kinds, tokens
 * placed and shown.
 * Writes outside the ledger: `core.moduleConfiguration`, and this seat's
 * `core.messageMode`, each restored in the finally.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { logDir, seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const ANIMATION = ["autoanimations", "sequencer", "JB2A_DnD5e"];
const DICE = "dice-so-nice";
/** `CONFIG.Dice.randomUniform` values that throw a natural 20 and a natural 1 on core 14. */
const NATURAL = { twenty: 0.025, one: 0.975 };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__aawBoot = { phase: "load", phases: [], errors: [] });
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
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async (ids) => ({
    user: game.user.name,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    active: game.users.filter((u) => u.active).map((u) => u.name),
    modules: Object.fromEntries(ids.map((id) => {
      const module = game.modules.get(id);
      return [id, module ? { active: module.active, version: module.version } : null];
    })),
    messageMode: game.settings.get("core", "messageMode"),
    boot: globalThis.__aawBoot ?? null,
  }),

  /** Write `on` into the module configuration; resolves to the value it replaced. */
  setModules: async ({ on }) => {
    const before = game.settings.get("core", "moduleConfiguration");
    await game.settings.set("core", "moduleConfiguration", { ...before, ...Object.fromEntries(on.map((id) => [id, true])) });
    return before;
  },

  putModules: async ({ value }) => {
    await game.settings.set("core", "moduleConfiguration", value);
    return true;
  },

  setMode: async ({ mode }) => {
    await game.settings.set("core", "messageMode", mode);
    return game.settings.get("core", "messageMode");
  },

  /** The seat's recorders: Sequencer's effects, Automated Animations' workflows, and refused writes. */
  install: async () => {
    const H = (globalThis.__aaw = globalThis.__aaw ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (H.armed) return "installed";
    H.armed = true;
    Object.assign(H, { effects: [], objects: new Map(), reads: [], ends: [], posted: [], errors: [], dice: [] });
    window.addEventListener("unhandledrejection", (e) => H.errors.push(String(e.reason?.message ?? e.reason)));
    const toast = ui.notifications.error.bind(ui.notifications);
    ui.notifications.error = (msg, opts) => { H.errors.push(`toast: ${String(msg)}`); return toast(msg, opts); };
    Hooks.on("createSequencerEffect", (effect) => {
      const d = effect.data;
      H.objects.set(d.id, effect);
      const placed = (object) => object?.document?.id ?? object?.id ?? null;
      H.effects.push({ id: d.id, file: String(d.file), source: placed(effect.source), target: placed(effect.target), missed: !!d.missed, at: Date.now() });
    });
    Hooks.on("AutomatedAnimations-WorkflowStart", (data, row) => H.reads.push({
      item: data.item?.name ?? null,
      row: row?.label ?? null,
      menu: row?.menu ?? null,
      playOnMiss: data.playOnMiss ?? null,
      hits: data.hitTargets?.length ?? null,
      targets: data.targets?.length ?? null,
      waits: data.deferrals?.length ?? 0,
    }));
    Hooks.on("aa.animationEnd", (_token, reason) => H.ends.push(String(reason)));
    Hooks.on("createChatMessage", (message, _options, userId) => {
      if (userId !== game.user.id) return;
      H.posted.push({ id: message.id, whispered: message.whisper.length, blind: message.blind, outcome: message.content?.match(/attack-throw-card__outcome--([a-z-]+)/)?.[1] ?? null });
    });
    Hooks.on("diceSoNiceRollComplete", (id) => H.dice.push({ id, at: Date.now() }));
    return "armed";
  },

  /** Every row named in `names` that Automated Animations' stored menus hold, as `menu/name`. */
  rows: async ({ names }) => {
    const held = [];
    for (const menu of ["melee", "range"]) {
      const stored = game.settings.get("autoanimations", `aaAutorec-${menu}`);
      for (const row of Array.isArray(stored) ? stored : Object.values(stored ?? {})) if (names.includes(row.label)) held.push(`${menu}/${row.label}`);
    }
    return held;
  },

  /** Take the module's listener off this page, or put back what was taken; resolves to how many moved. */
  listener: async ({ on }) => {
    const H = globalThis.__aaw;
    if (on) {
      const held = H.held ?? [];
      for (const fn of held) Hooks.on("aa.getRequiredData", fn);
      H.held = [];
      return held.length;
    }
    H.held = (Hooks.events["aa.getRequiredData"] ?? []).filter((row) => row.fn?.name === "annotateForAnimation").map((row) => row.fn);
    for (const fn of H.held) Hooks.off("aa.getRequiredData", fn);
    return H.held.length;
  },

  /** Ownership written whole: the attacker the Player seat's, the scene open to every seat. */
  own: async ({ sceneId, attackerId, playerId }) => {
    const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    await game.actors.get(attackerId).update({ ownership: { default: levels.NONE, [game.user.id]: levels.OWNER, [playerId]: levels.OWNER } });
    await game.scenes.get(sceneId).update({ ownership: { default: levels.LIMITED, [game.user.id]: levels.OWNER } });
    return true;
  },

  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,

  shapeItem: async ({ uuid, data }) => {
    await (await fromUuid(uuid)).update(data);
    return true;
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 20000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    return { scene: canvas.scene?.id ?? null, tokens: canvas.tokens?.placeables?.length ?? 0 };
  },

  place: async ({ rows }) => {
    await canvas.scene.updateEmbeddedDocuments("Token", rows, { animate: false });
    return true;
  },

  mark: async () => {
    const H = globalThis.__aaw;
    return { effects: H.effects.length, reads: H.reads.length, ends: H.ends.length, errors: H.errors.length };
  },

  /** One throw at `target`, by the real route, at a rigged die. `retarget` moves the seat's target after the throw has begun. */
  attack: async ({ token, actorId = null, item, type, die, target, retarget = null }) => {
    const H = globalThis.__aaw;
    const actor = actorId ? game.actors.get(actorId) : canvas.tokens.get(token).actor;
    const weapon = actor.items.find((i) => i.name === item);
    if (!weapon) return { error: `no ${item} on ${actor.name}` };
    canvas.tokens.setTargets(target ? [target] : []);
    const hook = retarget ? Hooks.once("preCreateChatMessage", () => canvas.tokens.setTargets([retarget])) : null;
    const rig = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => die;
    const seen = H.posted.length;
    try {
      await actor.makeAttackThrow({ item: weapon, attackType: type, skipDialog: true });
    } catch (err) {
      return { error: String(err?.message ?? err) };
    } finally {
      CONFIG.Dice.randomUniform = rig;
      if (hook !== null) Hooks.off("preCreateChatMessage", hook);
    }
    return { posted: H.posted.slice(seen) };
  },

  cast: async ({ token, item, target }) => {
    const H = globalThis.__aaw;
    const actor = canvas.tokens.get(token).actor;
    canvas.tokens.setTargets(target ? [target] : []);
    const seen = H.posted.length;
    await actor.items.find((i) => i.name === item).use({ skipDialog: true });
    const stop = Date.now() + 5000;
    while (Date.now() < stop && H.posted.length === seen) await H.sleep(50);
    return { posted: H.posted.slice(seen) };
  },

  /** Press the button Automated Animations adds to an item's sheet; resolves to what it opened, and closes it. */
  menu: async ({ token, item }) => {
    const H = globalThis.__aaw;
    const doc = canvas.tokens.get(token).actor.items.find((i) => i.name === item);
    await doc.sheet.render({ force: true });
    const control = [...doc.sheet._headerControlButtons()].find((c) => c.class === "aaItemSettings");
    if (!control) return { control: false };
    await control.onClick();
    const isMenu = (app) => /^A-A Item/.test(app.options?.title ?? "");
    const stop = Date.now() + 8000;
    while (Date.now() < stop && !Object.values(ui.windows).some((app) => isMenu(app) && app.rendered)) await H.sleep(100);
    const opened = Object.values(ui.windows).filter(isMenu);
    const shown = opened.map((app) => {
      const root = app.element?.[0] ?? app.element;
      const box = root?.getBoundingClientRect?.();
      return { title: app.title, rendered: app.rendered, size: box ? [Math.round(box.width), Math.round(box.height)] : null, errors: H.errors.length };
    });
    for (const app of opened) await app.close();
    await doc.sheet.close();
    return { control: true, shown };
  },

  /**
   * What this seat has seen since `mark`: waits for `want` effects, or the whole
   * time where `want` is 0. For each effect, where it lands and whether its file
   * is playing: two reads of the video's clock, a moment apart.
   */
  seen: async ({ mark, want, seconds }) => {
    const H = globalThis.__aaw;
    const stop = Date.now() + seconds * 1000;
    while (Date.now() < stop && (!want || H.effects.length - mark.effects < want)) await H.sleep(50);
    const effects = H.effects.slice(mark.effects);
    const drawn = [];
    for (const row of effects) {
      const effect = H.objects.get(row.id);
      const clock = () => { try { return effect.sprite?.currentTime ?? null; } catch { return null; } };
      const loaded = Date.now() + 4000;
      while (Date.now() < loaded && !(clock() > 0)) await H.sleep(25);
      const before = clock();
      await H.sleep(150);
      let at = null;
      try { at = effect.targetPosition ? { x: Math.round(effect.targetPosition.x), y: Math.round(effect.targetPosition.y) } : null; } catch {}
      drawn.push({ id: row.id, before, after: clock(), at, size: (() => { try { return [Math.round(effect.sprite?.width ?? 0), Math.round(effect.sprite?.height ?? 0)]; } catch { return null; } })() });
    }
    return { effects, drawn, reads: H.reads.slice(mark.reads), ends: H.ends.slice(mark.ends), errors: H.errors.slice(mark.errors) };
  },

  /** A token's centre on the canvas. */
  centre: async ({ token }) => {
    const { x, y } = canvas.tokens.get(token).center;
    return { x: Math.round(x), y: Math.round(y) };
  },

  dice: async ({ id }) => {
    const H = globalThis.__aaw;
    return { enabled: !!game.dice3d?.isEnabled?.(), done: H.dice.filter((row) => row.id === id) };
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

async function ready(api, label, seconds = 120) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * Reload a seat's page under the load recorder. A second DevTools session adds
 * it to every new document and stays open until the page is ready, since the
 * script lasts no longer than the session that added it.
 */
async function reloadRecorded(api, port, label) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next;
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

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

/** One throw from `api`, and what each seat in `watch` saw of it. */
async function strike(api, input, { watch = [api], want = 1, seconds = 12 } = {}) {
  const marks = await Promise.all(watch.map((seated) => run(seated, P.mark)));
  const thrown = await run(api, input.cast ? P.cast : P.attack, input);
  const seen = await Promise.all(watch.map((seated, i) => run(seated, P.seen, { mark: marks[i], want, seconds })));
  note(`  ${input.item ?? "?"}`, { thrown, seen });
  return { thrown, seen };
}

const playing = (drawn) => !!drawn && drawn.after !== null && drawn.before !== null && drawn.after > drawn.before;
const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null);

let restoreModules = null;
let restoreMode = null;
try {
  section("seats");
  const gm = await seat("gm");
  const census = await run(gm, P.census, [...ANIMATION, DICE]);
  note("gm census", census);
  if (!census.activeGMIsSelf) throw new Error("another GM client is the active GM");
  if (census.active.length > 1) throw new Error(`a seat is joined that is not this walk's: ${census.active.length} active`);
  const missing = [...ANIMATION, DICE].filter((id) => !census.modules[id]);
  if (missing.length) throw new Error(`not installed on this server: ${missing.join(", ")}`);
  restoreMode = census.messageMode;

  section("modules");
  restoreModules = await run(gm, P.setModules, { on: ANIMATION });
  note("gm reload (s)", await reloadRecorded(gm, PORTS.gm, "gm"));
  const loaded = await run(gm, P.census, ANIMATION);
  check("all three modules load with this one on the same page", ANIMATION.every((id) => loaded.modules[id]?.active), loaded.modules);
  check("the load reached ready under the recorder", loaded.boot?.phases?.includes("ready"), loaded.boot?.phases);
  check("the load logged no error", loaded.boot?.errors?.length === 0, loaded.boot?.errors);
  note("install (gm)", await run(gm, P.install));
  const named = ["Sword", "Dagger", "Unarmed Strike", "Bow"];
  const held = await run(gm, P.rows, { names: named });
  check("the default rows the listener names stand in Automated Animations' menus", named.every((name) => held.some((row) => row.endsWith(`/${name}`))), held);

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: SEATS.player });
  if (!playerId) throw new Error(`no user named ${SEATS.player}`);
  const scene = await gm.fixture("animations/scene", "Scene", { name: "Animations Walk", width: 1200, height: 800, grid: { size: 100 } });
  const attacker = await gm.fixture("animations/attacker", "Actor", { name: "Anim Attacker", type: "character" });
  const target = await gm.fixture("animations/target", "Actor", { name: "Anim Target", type: "monster" });
  const creature = await gm.fixture("animations/creature", "Actor", { name: "Anim Creature", type: "monster" });
  const loose = await gm.fixture("animations/loose", "Actor", { name: "Anim Loose", type: "monster" });
  const weapon = async (marker, owner, data) => {
    const item = await gm.fixture(marker, "Item", { type: "weapon", ...data }, { parent: owner.uuid });
    await run(gm, P.shapeItem, { uuid: item.uuid, data });
  };
  const MISSILE = { melee: false, missile: true };
  await weapon("animations/sword", attacker, { name: "Probe Sword" });
  await weapon("animations/blade", attacker, { name: "Probe Blade" });
  await weapon("animations/bow", attacker, { name: "Probe Bow", system: MISSILE });
  await weapon("animations/sling", attacker, { name: "Probe Sling", system: MISSILE });
  await weapon("animations/knife", attacker, { name: "Probe Shiv", system: { special: { thrown: true } } });
  await weapon("animations/maw", creature, { name: "Probe Maw" });
  await weapon("animations/loose-sword", loose, { name: "Probe Sword" });
  await gm.fixture("animations/missile", "Item", { name: "Probe Magic Missile", type: "spell" }, { parent: attacker.uuid });
  const token = (marker, actor, actorLink, x, y) => gm.fixture(marker, "Token", { name: actor.name, actorId: actor.id, actorLink, x, y }, { parent: scene.uuid });
  const attackerToken = await token("animations/attacker-token", attacker, true, 300, 300);
  const targetToken = await token("animations/target-token", target, true, 400, 300);
  const creatureToken = await token("animations/creature-token", creature, false, 400, 400);
  await run(gm, P.own, { sceneId: scene.id, attackerId: attacker.id, playerId });
  note("view (gm)", await run(gm, P.view, { sceneId: scene.id }));
  const adjacent = [{ _id: attackerToken.id, x: 300, y: 300, hidden: false }, { _id: targetToken.id, x: 400, y: 300, hidden: false }, { _id: creatureToken.id, x: 400, y: 400, hidden: false }];
  const apart = [{ _id: attackerToken.id, x: 300, y: 300, hidden: false }, { _id: targetToken.id, x: 800, y: 300, hidden: false }, { _id: creatureToken.id, x: 400, y: 400, hidden: false }];
  const at = (die) => ({ token: attackerToken.id, target: targetToken.id, die });

  section("a hit and a miss, in melee");
  await run(gm, P.place, { rows: adjacent });
  const centre = await run(gm, P.centre, { token: targetToken.id });
  {
    const { thrown, seen: [{ effects, drawn, reads, errors }] } = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Sword", type: "melee" });
    check("a melee hit: the card says so", thrown.posted?.[0]?.outcome && !thrown.posted[0].outcome.includes("miss"), thrown.posted);
    check("a melee hit: its own row, with the target hit", reads[0]?.row === "Sword" && reads[0]?.hits === 1 && reads[0]?.targets === 1, reads[0]);
    check("a melee hit: Sequencer draws it, not missed, source to target", effects.length >= 1 && !effects[0].missed && effects[0].source === attackerToken.id && effects[0].target === targetToken.id, effects[0]);
    check("a melee hit: the file is playing", playing(drawn[0]), drawn[0]);
    check("a melee hit: lands on the target", distance(drawn[0]?.at, centre) < 50, { at: drawn[0]?.at, centre });
    check("a melee hit: nothing refused", errors.length === 0, errors);
    await gm.shot(path.join(logDir(), "animations-melee-hit.png"), "#board").catch((err) => note("shot", err.message));
  }
  {
    const { thrown, seen: [{ effects, drawn, reads }] } = await strike(gm, { ...at(NATURAL.one), item: "Probe Sword", type: "melee" });
    check("a melee miss: the card says so", thrown.posted?.[0]?.outcome?.includes("miss"), thrown.posted);
    check("a melee miss: the target is named and no hit", reads[0]?.playOnMiss === true && reads[0]?.hits === 0 && reads[0]?.targets === 1, reads[0]);
    check("a melee miss: Sequencer draws it missed", effects.length >= 1 && effects[0].missed, effects[0]);
    check("a melee miss: lands off the target", distance(drawn[0]?.at, centre) > 0, { at: drawn[0]?.at, centre });
    await gm.shot(path.join(logDir(), "animations-melee-miss.png"), "#board").catch((err) => note("shot", err.message));
  }

  section("the control: the same miss with the listener off");
  {
    const taken = await run(gm, P.listener, { on: false });
    check("the listener is on the page, once", taken === 1, taken);
    const { thrown, seen: [{ effects, reads }] } = await strike(gm, { ...at(NATURAL.one), item: "Probe Sword", type: "melee" });
    await run(gm, P.listener, { on: true });
    check("without the listener a miss is drawn as a hit", thrown.posted?.[0]?.outcome?.includes("miss") && effects.length >= 1 && !effects[0].missed, { read: reads[0], effect: effects[0] });
  }

  section("a hit and a miss, at range");
  await run(gm, P.place, { rows: apart });
  const far = await run(gm, P.centre, { token: targetToken.id });
  {
    const { seen: [{ effects, drawn, reads }] } = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Bow", type: "missile" });
    check("a missile hit: its own row", reads[0]?.row === "Bow" && reads[0]?.hits === 1, reads[0]);
    check("a missile hit: drawn to the target, not missed", effects.length >= 1 && !effects[0].missed && distance(drawn[0]?.at, far) < 50, { effect: effects[0], at: drawn[0]?.at, far });
  }
  {
    const { seen: [{ effects, drawn, reads }] } = await strike(gm, { ...at(NATURAL.one), item: "Probe Bow", type: "missile" });
    check("a missile miss: no hit", reads[0]?.playOnMiss === true && reads[0]?.hits === 0, reads[0]);
    check("a missile miss: drawn missed, off the target", effects.length >= 1 && effects[0].missed && distance(drawn[0]?.at, far) > 0, { effect: effects[0], at: drawn[0]?.at, far });
  }

  section("a weapon with no row");
  {
    await run(gm, P.place, { rows: adjacent });
    const melee = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Blade", type: "melee" });
    check("a melee weapon falls to the Sword row", melee.seen[0].reads[0]?.row === "Sword" && melee.seen[0].effects.length >= 1, melee.seen[0].reads[0]);
    await run(gm, P.place, { rows: apart });
    const missile = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Sling", type: "missile" });
    check("a missile weapon falls to the Bow row", missile.seen[0].reads[0]?.row === "Bow" && missile.seen[0].effects.length >= 1, missile.seen[0].reads[0]);
    const thrown = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Shiv", type: "thrown" });
    check("a thrown weapon falls to the Dagger row", thrown.seen[0].reads[0]?.row === "Dagger" && thrown.seen[0].effects.length >= 1, thrown.seen[0].reads[0]);
  }

  section("an unlinked creature");
  {
    await run(gm, P.place, { rows: adjacent });
    const miss = await strike(gm, { token: creatureToken.id, target: targetToken.id, die: NATURAL.one, item: "Probe Maw", type: "melee" });
    const [{ effects, reads }] = miss.seen;
    check("a creature's attack falls to the Unarmed Strike row", reads[0]?.row === "Unarmed Strike", reads[0]);
    check("the synthetic actor's attack is found in flight: its miss reads", reads[0]?.playOnMiss === true && effects[0]?.missed === true, effects[0]);
    check("the effect starts at the unlinked token", effects[0]?.source === creatureToken.id, effects[0]?.source);
  }

  section("the target");
  {
    await run(gm, P.place, { rows: adjacent });
    const moved = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Sword", type: "melee", retarget: creatureToken.id });
    check("the target moved mid-roll: the effect goes where the throw was made", moved.seen[0].effects[0]?.target === targetToken.id, moved.seen[0].effects[0]?.target);
    const none = await strike(gm, { token: attackerToken.id, target: null, die: NATURAL.twenty, item: "Probe Sword", type: "melee" }, { want: 0, seconds: 4 });
    check("an attack at nothing plays nothing and refuses nothing", none.seen[0].effects.length === 0 && none.seen[0].errors.length === 0, { ends: none.seen[0].ends, errors: none.seen[0].errors });
  }

  section("an attack from a world actor's own sheet");
  {
    const sheet = await strike(gm, { actorId: creature.id, target: targetToken.id, die: NATURAL.one, item: "Probe Maw", type: "melee" });
    const [{ effects, reads }] = sheet.seen;
    check("a world actor's attack reads through the card's unlinked token", reads[0]?.row === "Unarmed Strike" && effects[0]?.missed === true && effects[0]?.source === creatureToken.id, { read: reads[0], effect: effects[0] });
    const stray = await strike(gm, { actorId: loose.id, target: targetToken.id, die: NATURAL.twenty, item: "Probe Sword", type: "melee" }, { want: 0, seconds: 4 });
    check("an actor with no token on the map plays nothing and refuses nothing", stray.seen[0].effects.length === 0 && stray.seen[0].errors.length === 0 && !stray.thrown.error, { errors: stray.seen[0].errors, thrown: stray.thrown });
  }

  section("a Judge's own row");
  {
    const menu = await run(gm, P.menu, { token: attackerToken.id, item: "Probe Blade" });
    check("the item sheet's button opens Automated Animations' menu on a system item", menu.control && menu.shown?.length === 1 && menu.shown[0].rendered, menu);
  }

  section("a spell");
  {
    await run(gm, P.place, { rows: apart });
    const { seen: [{ effects, reads }] } = await strike(gm, { cast: true, token: attackerToken.id, target: targetToken.id, item: "Probe Magic Missile" });
    check("a spell plays its own row with nothing written", reads[0]?.row === "Magic Missile" && reads[0]?.playOnMiss !== true && effects.length >= 1, reads[0]);
  }

  section("a second seat");
  const player = await seat("player");
  note("install (player)", await run(player, P.install));
  note("view (player)", await run(player, P.view, { sceneId: scene.id }));
  const both = [gm, player];
  {
    await run(gm, P.place, { rows: adjacent });
    const { thrown, seen } = await strike(player, { ...at(NATURAL.one), item: "Probe Sword", type: "melee" }, { watch: both });
    check("a Player's attack: a card of the Player's", thrown.posted?.[0]?.outcome?.includes("miss"), thrown.posted);
    check("a Player's miss is drawn missed on both seats", seen.every((s) => s.effects[0]?.missed === true), seen.map((s) => s.effects[0]));
  }
  {
    const shown = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Sword", type: "melee" }, { watch: both });
    check("a public attack of the GM's reaches the Player's canvas", shown.seen[1].effects.length >= 1 && !shown.seen[1].effects[0].missed, shown.seen[1].effects[0]);
  }

  section("what a hidden result and a hidden token keep");
  for (const mode of ["gm", "blind"]) {
    note("message mode", await run(gm, P.setMode, { mode }));
    const { thrown, seen } = await strike(gm, { ...at(NATURAL.one), item: "Probe Sword", type: "melee" }, { watch: both });
    const posted = thrown.posted?.[0];
    check(`a ${mode} card is not public`, posted && (posted.whispered > 0 || posted.blind), posted);
    check(`a ${mode} miss: the listener writes no result`, seen[0].reads[0]?.playOnMiss !== true && seen[0].reads[0]?.targets === 1, seen[0].reads[0]);
    check(`a ${mode} miss plays plain on both seats`, seen.every((s) => s.effects.length >= 1 && s.effects[0].missed === false), seen.map((s) => s.effects[0]));
  }
  note("message mode", await run(gm, P.setMode, { mode: restoreMode }));
  {
    await run(gm, P.place, { rows: [{ _id: attackerToken.id, hidden: true }] });
    const { thrown, seen } = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Sword", type: "melee" }, { watch: both, want: 0, seconds: 5 });
    check("a hidden token's card still posts", !!thrown.posted?.length, thrown.posted);
    check("a hidden token plays nothing on either seat", seen.every((s) => s.effects.length === 0), seen.map((s) => ({ effects: s.effects.length, reads: s.reads.length })));
    const cast = await strike(gm, { cast: true, token: attackerToken.id, target: targetToken.id, item: "Probe Magic Missile" }, { watch: both, want: 0, seconds: 5 });
    check("a hidden token's spell plays nothing on either seat", !!cast.thrown.posted?.length && cast.seen.every((s) => s.effects.length === 0), cast.seen.map((s) => s.effects.length));
    await run(gm, P.place, { rows: [{ _id: attackerToken.id, hidden: false }] });
  }
  await seats.player.close();
  delete seats.player;

  section("the dice");
  note("gm reload (s)", await (async () => {
    await run(gm, P.setModules, { on: [DICE] });
    return reloadRecorded(gm, PORTS.gm, "gm");
  })());
  const dressed = await run(gm, P.census, [DICE]);
  check("Dice So Nice loads beside them with no error", dressed.modules[DICE]?.active && dressed.boot?.errors?.length === 0, { module: dressed.modules[DICE], errors: dressed.boot?.errors });
  note("install (gm)", await run(gm, P.install));
  note("view (gm)", await run(gm, P.view, { sceneId: scene.id }));
  {
    await run(gm, P.place, { rows: adjacent });
    const { thrown, seen: [{ effects, reads }] } = await strike(gm, { ...at(NATURAL.twenty), item: "Probe Sword", type: "melee" }, { seconds: 30 });
    const posted = thrown.posted?.[0];
    const dice = await run(gm, P.dice, { id: posted?.id });
    check("the workflow holds the wait for this card's dice", reads[0]?.waits === 1, reads[0]);
    check("the dice are shown on this seat", dice.enabled && dice.done.length >= 1, dice);
    check("the effect starts after the dice finish", effects[0] && dice.done[0] && effects[0].at >= dice.done[0].at, { effect: effects[0]?.at, dice: dice.done[0]?.at });
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
} finally {
  section("teardown");
  if (seats.gm) {
    if (restoreMode !== null) {
      try { note("message mode restored", await run(seats.gm, P.setMode, { mode: restoreMode })); } catch (err) { console.error("restore message mode:", err?.message ?? err); }
    }
    if (restoreModules !== null) {
      try { note("module configuration restored", await run(seats.gm, P.putModules, { value: restoreModules })); } catch (err) { console.error("restore modules:", err?.message ?? err); }
    }
  }
  for (const api of Object.values(seats)) {
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
