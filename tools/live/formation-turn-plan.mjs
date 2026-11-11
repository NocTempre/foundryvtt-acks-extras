/**
 * Live walk: docs/formation/TESTING.md "The turn plan". Two seats. The Player
 * seat's sheet opens while the Judge's write of the roster lands inside its
 * first render, and settles on the written roster. The Player seat locks a search for the member it owns from the party sheet's Turn plan
 * column and is refused one it does not own; the Judge locks for another; a move
 * cancels; Turn spends one turn and rolls the searcher on one card whose target
 * is the member's Rolls-tab figure; a fight cancels on one card.
 *
 * Every figure typed into a fixture is invented. Fixtures, kept and found again
 * by marker (`api.fixture`): the scene `formation/plan-scene`; the party
 * `formation/plan-party` holding `formation/plan-thief` (owned by the Player
 * seat, with a hand-made ability bound to Search and an invented flat throw),
 * `formation/plan-fighter` and `formation/plan-cleric`. The walk brings them to
 * its start shape itself: the three in the party, its token on the scene, no
 * plan, no fight, not paused, nobody moved this turn.
 * Tracked by id and swept: every chat card the GM seat posts during the run,
 * the combat the fight step makes, and the two items the Endurance step gives
 * the fighter (a copy of the library's Endurance and a gear item named for it).
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCOPE = "acks-extras";
const NONCE = "tpl" + Math.random().toString(36).slice(2, 7);
const SEARCH_ITEM = "QA Plan Search";
const INVENTED_TARGET = 14;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__tplBoot = { phase: "load", phases: [], errors: [] });
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
  census: async () => ({
    user: game.user.name,
    userId: game.user.id,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    boot: globalThis.__tplBoot ?? null,
  }),

  install: async ({ nonce }) => {
    const H = (globalThis.__tpl = globalThis.__tpl ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        let v = null;
        try { v = await fn(); } catch { v = null; }
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.requests = await import(`${base}formation/player-requests.mjs`);
    H.plan = await import(`${base}formation/turn-plan.mjs`);
    H.rolls = await import(`${base}character-sheet/rolls.mjs`);
    H.notes ??= [];
    if (!H.wrapped) {
      H.wrapped = true;
      for (const level of ["info", "warn"]) {
        const fn = ui.notifications[level];
        ui.notifications[level] = function (msg, ...rest) {
          H.notes.push(String(msg));
          return fn.call(this, msg, ...rest);
        };
      }
    }
    if (game.user.isGM && !H.cards) {
      H.cards = [];
      Hooks.on("preCreateChatMessage", (doc, _d, _o, userId) => { if (userId === game.user.id) doc.updateSource({ "flags.world.qaNonce": nonce }); });
      Hooks.on("createChatMessage", (m) => {
        if (m.flags?.world?.qaNonce !== nonce) return;
        H.cards.push({ id: m.id, uuid: m.uuid, at: Date.now(), html: `${m.flavor ?? ""} ${m.content ?? ""}`, whisper: [...(m.whisper ?? [])] });
      });
    }
    return { ok: typeof H.plan.resolvePlanTurn === "function" && typeof H.plan.registerFormationActivities === "function" };
  },

  nowMs: async () => Date.now(),

  formationOf: async ({ partyId }) => {
    const H = globalThis.__tpl;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** The hand-made Search item on the thief, rebuilt to the walk's invented throw. */
  searchItem: async ({ actorId, name, target }) => {
    const actor = game.actors.get(actorId);
    for (const old of actor.items.filter((i) => i.name === name)) await old.delete();
    await actor.createEmbeddedDocuments("Item", [{
      name, type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 0 },
      flags: { "acks-extras": { checkKey: "search", extras: { rolls: [{ key: "primary", label: "Search", rollType: "above", scale: "level", target: { kind: "flat", flat: target } }] } } },
    }]);
    return actor.items.filter((i) => i.name === name).length;
  },

  /**
   * The start shape: the three members in the party on the walk's scene, the
   * party token there, no plan, no fight, not paused, nobody moved this turn.
   */
  startShape: async ({ fid, partyId, sceneId, members }) => {
    const H = globalThis.__tpl;
    const scene = game.scenes.get(sceneId);
    const party = game.actors.get(partyId);
    for (const c of game.combats.filter((c) => c.combatants.some((x) => x.actorId === partyId))) await c.delete();
    await H.sleep(500);
    await H.model.patchFormation(fid, (rec) => {
      rec.combat = null;
      rec.clock.paused = false;
      rec.clock.movedThisTurn = false;
    });
    const f0 = H.model.getFormation(fid);
    if (f0.sceneId && f0.sceneId !== sceneId) {
      await H.model.removeMembers(f0, f0.members.filter((m) => m?.actorId).map((m) => m.actorId), { restore: false });
    }
    for (const [n, id] of members.entries()) {
      const f = H.model.getFormation(fid);
      if (f.members.some((m) => m?.actorId === id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: 400 + n * 100, y: 400 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), made, { scene });
    }
    for (const id of members) {
      const actor = game.actors.get(id);
      await actor.update({ "system.hp.value": actor.system.hp?.max ?? 8 });
    }
    if (party.getFlag("acks-extras", "turnPlan")) await party.unsetFlag("acks-extras", "turnPlan");
    await H.sleep(800);
    const f = H.model.getFormation(fid);
    return {
      members: f.members.filter((m) => m?.actorId).map((m) => m.actorId),
      sceneId: f.sceneId,
      partyToken: !!H.model.getPartyToken(f),
      plan: party.getFlag("acks-extras", "turnPlan") ?? null,
      paused: !!f.clock.paused,
      moved: !!f.clock.movedThisTurn,
      combat: !!f.combat?.active,
    };
  },

  /** The stored plan and the clock, read on this seat. */
  state: async ({ fid, partyId }) => {
    const H = globalThis.__tpl;
    const f = H.model.getFormation(fid);
    return {
      plan: game.actors.get(partyId).getFlag("acks-extras", "turnPlan") ?? null,
      turns: f.clock.turnsTotal,
      rounds: f.clock.roundsPartial ?? 0,
      moved: !!f.clock.movedThisTurn,
      combat: !!f.combat?.active,
    };
  },

  /** How long this seat's copy of the formation takes to hold `count` members, in ms (null: never). */
  heldOn: async ({ partyId, count }) => {
    const H = globalThis.__tpl;
    const start = Date.now();
    const ok = await H.poll(() => H.model.realMembers(Object.values(H.model.getFormations()).find((f) => f.actorId === partyId)).length === count || null, { tries: 100, every: 100 });
    return ok ? Date.now() - start : null;
  },

  /**
   * Endurance, told by capability: the library's ability whose definition id
   * folds to `kw:endurance`, copied onto the member, and a gear item named for
   * it, which must count for nothing. Returns the ids the run made.
   */
  endurance: async ({ actorId }) => {
    const H = globalThis.__tpl;
    const engine = await import("/modules/acks-extras/scripts/formation/turn-engine.mjs");
    const lib = await import("/modules/acks-extras/scripts/lib/library.mjs");
    const vocab = await import("/modules/acks-extras/scripts/lib/vocab.mjs");
    await lib.whenReady();
    const actor = game.actors.get(actorId);
    const source = lib.libraryItems().find((i) => i.type === "ability" && vocab.capabilityForId(lib.cookbookId(i)) === "kw:endurance");
    const before = engine.hasEndurance(actor);
    const [named] = await actor.createEmbeddedDocuments("Item", [{ name: "QA Rope of Endurance", type: "item" }]);
    const namedOnly = engine.hasEndurance(actor);
    const made = [named.uuid];
    let imported = null;
    if (source) {
      const [copy] = await actor.createEmbeddedDocuments("Item", [source.toObject()]);
      made.push(copy.uuid);
      imported = engine.hasEndurance(actor);
    }
    await H.sleep(200);
    return { found: !!source, before, namedOnly, imported, made };
  },

  /** The Judge takes one member out of the party, leaving the token where it was dropped. */
  dropMember: async ({ fid, actorId }) => {
    const H = globalThis.__tpl;
    await H.model.removeMembers(H.model.getFormation(fid), [actorId], { restore: false });
    return H.model.realMembers(H.model.getFormation(fid)).length;
  },

  /**
   * Open the party sheet with its first render held after its context is read
   * and before its HTML is drawn: the gap a formation write can land in. The
   * hold is the instance's own `_preRender`, removed again by `release`.
   */
  openHeld: async ({ partyId }) => {
    const H = globalThis.__tpl;
    const sheet = game.actors.get(partyId).sheet;
    if (sheet.rendered) await sheet.close({ animate: false });
    const proto = Object.getPrototypeOf(sheet)._preRender;
    let entered = false;
    H.gate = new Promise((resolve) => { H.openGate = resolve; });
    sheet._preRender = async function (context, options) {
      if (options.isFirstRender) {
        entered = true;
        await H.gate;
      }
      return proto.call(this, context, options);
    };
    H.held = sheet.render(true);
    const reached = await H.poll(() => entered || null, { tries: 50, every: 100 });
    return { entered: !!reached, state: sheet.state };
  },

  /** Let the held first render finish, then read the rows it drew and the rows the sheet settles on. */
  release: async ({ partyId, count }) => {
    const H = globalThis.__tpl;
    const sheet = game.actors.get(partyId).sheet;
    const shown = () => H.root(sheet)?.querySelectorAll("[data-plan-actor]").length ?? 0;
    H.openGate();
    await H.held;
    delete sheet._preRender;
    const drawn = shown();
    const settled = await H.poll(() => shown() === count || null, { tries: 30, every: 100 });
    return { drawn, settled: !!settled, rows: shown(), rendered: !!sheet.rendered };
  },

  /** Open the party sheet on its Dungeon tab and read the Turn plan rows as this seat sees them. */
  column: async ({ partyId }) => {
    const H = globalThis.__tpl;
    const sheet = game.actors.get(partyId).sheet;
    const held = () => H.model.realMembers(Object.values(H.model.getFormations()).find((f) => f.actorId === partyId)).length;
    const shownNow = () => H.root(sheet)?.querySelectorAll("[data-plan-actor]").length ?? 0;
    // What the seat holds and shows before this probe waits on anything: a lag is reported, never smoothed over.
    const first = { wasRendered: !!sheet.rendered, shown: sheet.rendered ? shownNow() : null, held: held() };
    if (!sheet.rendered) await sheet.render(true);
    await H.sleep(300);
    first.shownAfterRender = shownNow();
    first.heldAfterRender = held();
    await H.poll(() => {
      const shown = H.root(sheet)?.querySelectorAll("[data-plan-actor]").length ?? 0;
      return shown > 0 && shown === held();
    }, { tries: 40, every: 200 });
    H.root(sheet)?.querySelector('[data-action="tab"][data-tab="mode"]')?.click();
    await H.sleep(300);
    const root = H.root(sheet);
    const rows = [...(root?.querySelectorAll("[data-plan-actor]") ?? [])].map((row) => ({
      actorId: row.dataset.planActor,
      entry: row.querySelector(".acks-extras-turn-plan-entry")?.textContent.replace(/\s+/g, " ").trim() ?? "",
      block: row.querySelector(".acks-extras-turn-plan-block")?.textContent.trim() ?? "",
      select: !!row.querySelector("select[data-pick]"),
      options: [...(row.querySelector("select[data-pick]")?.options ?? [])].map((o) => ({ value: o.value, disabled: o.disabled })),
      lock: !!row.querySelector('[data-action="planLock"]'),
    }));
    const record = Object.values(H.model.getFormations()).find((f) => f.actorId === partyId);
    const members = H.model.realMembers(record).map((m) => ({ id: m.actorId, known: !!game.actors.get(m.actorId) }));
    return { rendered: !!sheet.rendered, rows, members, first };
  },

  /** Pick a choice in a member's row and press Lock, as a hand would. */
  lockInColumn: async ({ partyId, actorId, value }) => {
    const H = globalThis.__tpl;
    const sheet = game.actors.get(partyId).sheet;
    const row = H.root(sheet)?.querySelector(`[data-plan-actor="${actorId}"]`);
    const select = row?.querySelector("select[data-pick]");
    if (!select) return { pressed: false };
    select.value = value;
    const before = H.notes.length;
    row.querySelector('[data-action="planLock"]').click();
    await H.sleep(1200);
    return { pressed: select.value === value, notes: H.notes.slice(before) };
  },

  /** The relay sent straight, for a member the seat does not own: the column offers no control for it. */
  relay: async ({ fid, actorId, key }) => {
    const H = globalThis.__tpl;
    await H.requests.requestPartyAction(fid, "plan", { actorId, key });
    await H.sleep(1500);
    return true;
  },

  /** The GM's lock, the way the column's handler writes it. */
  gmLock: async ({ fid, actorId, key }) => {
    const H = globalThis.__tpl;
    return H.plan.lockPlan(H.model.getFormation(fid), { actorId, key, by: game.user.id });
  },

  /** Drag the party token across the scene: a move the turn clock bills. */
  move: async ({ fid, cells }) => {
    const H = globalThis.__tpl;
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    const grid = token.parent.grid.size;
    await token.update({ x: token.x + cells * grid }, { animate: false });
    return !!(await H.poll(() => H.model.getFormation(fid).clock.movedThisTurn || null, { tries: 40, every: 150 }));
  },

  /** Press a member row's Keep watch, as a hand would. */
  keepWatch: async ({ partyId, actorId }) => {
    const H = globalThis.__tpl;
    const button = H.root(game.actors.get(partyId).sheet)?.querySelector(`[data-plan-actor="${actorId}"] [data-action="planUnlock"]`);
    if (!button) return false;
    button.click();
    await H.sleep(1200);
    return true;
  },

  /** Press the Dungeon tab's Turn (or, with `action: "restTurn"`, Rest a turn) on the party sheet. */
  pressTurn: async ({ partyId, fid, turns, action = "advanceTurn" }) => {
    const H = globalThis.__tpl;
    const sheet = game.actors.get(partyId).sheet;
    if (!sheet.rendered) await sheet.render(true);
    await H.sleep(500);
    H.root(sheet)?.querySelector('[data-action="tab"][data-tab="mode"]')?.click();
    await H.sleep(200);
    const pill = H.root(sheet)?.querySelector(`[data-action="${action}"]`);
    if (!pill) return { pressed: false };
    pill.click();
    const done = await H.poll(() => H.model.getFormation(fid).clock.turnsTotal > turns || null, { tries: 60, every: 200 });
    await H.sleep(1500);
    return { pressed: true, advanced: !!done };
  },

  /** The cards posted since `since`, with each search row's member and target. */
  cardsSince: async ({ since }) => {
    const H = globalThis.__tpl;
    const gms = game.users.filter((u) => u.isGM).map((u) => u.id);
    return H.cards.filter((c) => c.at >= since).map((c) => {
      const box = document.createElement("div");
      box.innerHTML = c.html;
      const title = box.querySelector(".acks-chat-title")?.textContent.trim() ?? "";
      const rows = [...box.querySelectorAll("table.acks-table tbody tr")].map((tr) => {
        const tds = tr.querySelectorAll("td");
        return { name: tds[0]?.childNodes[0]?.textContent.trim() ?? "", target: Number(/-?\d+/.exec(tds[2]?.textContent ?? "")?.[0] ?? NaN) };
      });
      return { id: c.id, uuid: c.uuid, title, rows, text: box.textContent.replace(/\s+/g, " ").slice(0, 200), toJudges: c.whisper.length > 0 && c.whisper.every((u) => gms.includes(u)), isPublic: !c.whisper.length };
    });
  },

  /**
   * The member's Rolls tab figure for the bound item's throw: its own row, or
   * the Adventuring row that stands behind it and lists it there instead.
   */
  rollsFigure: async ({ actorId, name }) => {
    const H = globalThis.__tpl;
    const actor = game.actors.get(actorId);
    const item = actor.items.find((i) => i.name === name);
    const rows = H.rolls.rollInventory(actor).groups.flatMap((g) => g.rows);
    const row = rows.find((r) => r.id === `abl:${item?.id}:primary`) ?? rows.find((r) => r.id === "adv:searching");
    const m = /-?\d+/.exec(String(row?.value ?? ""));
    return { row: row?.id ?? null, value: row?.value ?? null, figure: m ? Number(m[0]) : null };
  },

  /** A fight on the scene with the party token in it: the combat deploy runs on this, the primary GM. */
  fight: async ({ fid, partyId }) => {
    const H = globalThis.__tpl;
    const token = H.model.getPartyToken(H.model.getFormation(fid));
    const combat = await Combat.create({ scene: token.parent.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: token.id, sceneId: token.parent.id, actorId: partyId }]);
    const deployed = await H.poll(() => H.model.getFormation(fid).combat?.active || null, { tries: 60, every: 200 });
    await H.sleep(1500);
    return { uuid: combat.uuid, id: combat.id, deployed: !!deployed };
  },
  endFight: async ({ fid, combatId }) => {
    const H = globalThis.__tpl;
    await game.combats.get(combatId)?.delete();
    const over = await H.poll(() => !H.model.getFormation(fid).combat?.active || null, { tries: 60, every: 200 });
    await H.sleep(800);
    return !!over;
  },

  closeSheet: async ({ partyId }) => {
    const sheet = game.actors.get(partyId).sheet;
    if (sheet.rendered) await sheet.close({ animate: false });
    return true;
  },

  boot: async () => globalThis.__tplBoot ?? null,
};

async function run(api, fn, args = {}, timeout = undefined) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`, timeout);
  return JSON.parse(text);
}

const ready = async (api, label) => {
  for (let n = 0; n < 600; n++) {
    const ok = await api.eval(`!!(globalThis.game?.ready && globalThis.acksExtras?.formation)`).catch(() => false);
    if (ok) return n / 2;
    await sleep(500);
  }
  throw new Error(`${label} never reached ready`);
};

/** The recorder has to be in the page before the page loads, so it goes in over the seat's own CDP target. */
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

const character = (name, extra = {}) => ({
  name, type: "character", prototypeToken: { actorLink: true },
  system: { hp: { value: 8, max: 8 }, details: { level: 3 }, adventuring: { listening: 18, searching: 18, dungeonbashing: 18 } },
  ...extra,
});
const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);

const open = {};
const tracked = [];

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  note("installed", [await run(gm, P.install, { nonce: NONCE }), await run(player, P.install, { nonce: NONCE })]);
  const census = { gm: await run(gm, P.census), player: await run(player, P.census) };
  check("the GM seat is the active GM, and the player seat is a player", census.gm.activeGMIsSelf && census.player.role <= 2, { gm: census.gm.role, player: census.player.role });
  if (!census.gm.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  for (const [key, c] of Object.entries(census)) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }

  section("fixtures");
  const yours = { default: 0, [census.player.userId]: 3 };
  const scene = await gm.fixture("formation/plan-scene", "Scene", { name: "Turn Plan Walk", width: 2000, height: 1000, grid: { size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  const party = await gm.fixture("formation/plan-party", "Actor", { name: "QA Plan Party", type: `${SCOPE}.party` });
  const thief = await gm.fixture("formation/plan-thief", "Actor", character("QA Plan Thief", { ownership: yours }));
  const fighter = await gm.fixture("formation/plan-fighter", "Actor", character("QA Plan Fighter"));
  const cleric = await gm.fixture("formation/plan-cleric", "Actor", character("QA Plan Cleric"));
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  note("search item built", await run(gm, P.searchItem, { actorId: thief.id, name: SEARCH_ITEM, target: INVENTED_TARGET }));
  const shape = await run(gm, P.startShape, { fid, partyId: party.id, sceneId: scene.id, members: [thief.id, fighter.id, cleric.id] });
  note("start shape", shape);
  check("the walk starts with the three in the party on its scene, the party token there, no plan, no fight, nobody moved",
    shape.members.length === 3 && shape.sceneId === scene.id && shape.partyToken && !shape.plan && !shape.paused && !shape.moved && !shape.combat, shape);

  section("a first render that a member write overlaps");
  // The player opens the sheet while the cleric is out of the party; its first render is held
  // between reading the roster and drawing it, and the Judge brings the cleric back in that gap.
  note("the Judge takes the cleric out; members left", await run(gm, P.dropMember, { fid, actorId: cleric.id }));
  note("player seat's record held the two after (ms)", await run(player, P.heldOn, { partyId: party.id, count: 2 }));
  const held = await run(player, P.openHeld, { partyId: party.id });
  check("the player's first render is held after it read the roster", held.entered, held);
  const back = await run(gm, P.startShape, { fid, partyId: party.id, sceneId: scene.id, members: [thief.id, fighter.id, cleric.id] });
  const heldThree = await run(player, P.heldOn, { partyId: party.id, count: 3 });
  note("player seat's record held the three again after (ms), while the render was held", heldThree);
  const released = await run(player, P.release, { partyId: party.id, count: 3 });
  note("released", released);
  check("the write landed during the held render: the Judge's party is three again and the player's record followed",
    back.members.length === 3 && heldThree !== null, { members: back.members.length, heldThree });
  check("the held render drew the roster it read, and the sheet then redraws to the three", released.drawn === 2 && released.settled && released.rows === 3, released);

  section("the player locks a search for the member they own");
  const playerCol = await run(player, P.column, { partyId: party.id });
  const rowOf = (col, id) => col.rows.find((r) => r.actorId === id) ?? null;
  note("player column, first sample", playerCol.first);
  check("the player's sheet shows a Turn plan row for each of the three", playerCol.rendered && playerCol.rows.length === 3, { rows: playerCol.rows.length, members: playerCol.members });
  check("the thief's row offers choices and Lock; the rows of members the player does not own offer none",
    rowOf(playerCol, thief.id)?.select && rowOf(playerCol, thief.id)?.lock
      && !!rowOf(playerCol, fighter.id) && !rowOf(playerCol, fighter.id).select && !!rowOf(playerCol, cleric.id) && !rowOf(playerCol, cleric.id).select,
    playerCol.rows.map((r) => ({ select: r.select, lock: r.lock })));
  check("the thief's choices include a methodical search that is open, and battering listed as refused",
    !!rowOf(playerCol, thief.id)?.options.find((o) => o.value === "searchMethodical|" && !o.disabled) && !!rowOf(playerCol, thief.id)?.options.find((o) => o.value === "batter|" && o.disabled),
    rowOf(playerCol, thief.id)?.options);
  let since = await run(gm, P.nowMs);
  const locked = await run(player, P.lockInColumn, { partyId: party.id, actorId: thief.id, value: "searchMethodical|" });
  let st = await run(gm, P.state, { fid, partyId: party.id });
  check("pressing Lock on the player's seat stores the thief's search, by the player", locked.pressed && st.plan?.[thief.id]?.key === "searchMethodical" && st.plan[thief.id].by === census.player.userId, { plan: st.plan, notes: locked.notes });
  let cards = await run(gm, P.cardsSince, { since });
  for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
  check("the table is told, on one public line", cards.length === 1 && cards[0].isPublic, cards.map((c) => c.text));

  section("refused on a member the player does not own");
  await run(player, P.relay, { fid, actorId: fighter.id, key: "searchMethodical" });
  st = await run(gm, P.state, { fid, partyId: party.id });
  check("the relay for the fighter writes nothing", !st.plan?.[fighter.id], st.plan);

  section("the Judge locks for another");
  const gmCol = await run(gm, P.column, { partyId: party.id });
  check("the Judge's column offers choices on every row", gmCol.rows.length === 3 && gmCol.rows.every((r) => r.select && r.lock), gmCol.rows.map((r) => r.select));
  const gmLocked = await run(gm, P.lockInColumn, { partyId: party.id, actorId: cleric.id, value: "listen|" });
  st = await run(gm, P.state, { fid, partyId: party.id });
  check("pressing Lock on the Judge's seat stores the cleric's listen", gmLocked.pressed && st.plan?.[cleric.id]?.key === "listen", st.plan);
  check("Keep watch on the cleric's row is pressed", await run(gm, P.keepWatch, { partyId: party.id, actorId: cleric.id }));
  st = await run(gm, P.state, { fid, partyId: party.id });
  check("Keep watch clears the cleric's entry and leaves the thief's", !st.plan?.[cleric.id] && st.plan?.[thief.id]?.key === "searchMethodical", st.plan);
  await run(gm, P.column, { partyId: party.id });
  await run(gm, P.lockInColumn, { partyId: party.id, actorId: cleric.id, value: "listen|" });
  for (const c of await run(gm, P.cardsSince, { since: 0 })) tracked.push(gm.track(c.uuid, "ChatMessage"));

  section("moving cancels");
  since = await run(gm, P.nowMs);
  const moved = await run(gm, P.move, { fid, cells: 5 });
  await sleep(1500);
  st = await run(gm, P.state, { fid, partyId: party.id });
  check("a move the clock bills clears every open entry", moved && st.moved && !st.plan, { moved, plan: st.plan });
  cards = await run(gm, P.cardsSince, { since });
  for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
  check("and says so on one public line", cards.filter((c) => c.isPublic && /QA Plan Thief/.test(c.text) && /QA Plan Cleric/.test(c.text)).length === 1, cards.map((c) => c.text));
  const blocked = await run(player, P.column, { partyId: party.id });
  check("the player's column now shows the reason on the row and no choice to lock", !!rowOf(blocked, thief.id)?.block && !rowOf(blocked, thief.id)?.select, rowOf(blocked, thief.id));

  section("Turn: one turn spent, one card, the Rolls-tab figure");
  // A new turn clears the move; the turn the walk measures starts from there.
  let before = await run(gm, P.state, { fid, partyId: party.id });
  await run(gm, P.pressTurn, { partyId: party.id, fid, turns: before.turns });
  since = await run(gm, P.nowMs);
  for (const c of await run(gm, P.cardsSince, { since: 0 })) tracked.push(gm.track(c.uuid, "ChatMessage"));
  const relocked = await run(player, P.column, { partyId: party.id });
  check("after a turn standing still, the player's column offers choices again", !!rowOf(relocked, thief.id)?.select, rowOf(relocked, thief.id));
  await run(player, P.lockInColumn, { partyId: party.id, actorId: thief.id, value: "searchMethodical|" });
  before = await run(gm, P.state, { fid, partyId: party.id });
  check("the search is locked before the turn", before.plan?.[thief.id]?.key === "searchMethodical", before.plan);
  since = await run(gm, P.nowMs);
  const pressed = await run(gm, P.pressTurn, { partyId: party.id, fid, turns: before.turns });
  const after = await run(gm, P.state, { fid, partyId: party.id });
  check("Turn spends exactly one turn and no stray round", pressed.advanced && after.turns === before.turns + 1 && after.rounds === before.rounds, { before: [before.turns, before.rounds], after: [after.turns, after.rounds] });
  cards = await run(gm, P.cardsSince, { since });
  for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
  const searchCards = cards.filter((c) => c.rows.length && c.toJudges);
  check("one card for the search, to the Judges, with one row: the thief", searchCards.length === 1 && searchCards[0].rows.length === 1 && searchCards[0].rows[0].name === "QA Plan Thief", cards.map((c) => ({ title: c.title, rows: c.rows.length, toJudges: c.toJudges })));
  const rollsTab = await run(gm, P.rollsFigure, { actorId: thief.id, name: SEARCH_ITEM });
  check("the card's target is the thief's Rolls-tab figure for the throw", rollsTab.figure !== null && searchCards[0]?.rows[0]?.target === rollsTab.figure, { card: searchCards[0]?.rows[0]?.target, rolls: rollsTab.figure });
  check("the entry is stamped with the turn", after.plan?.[thief.id]?.resolvedTurn === after.turns, after.plan);

  section("Rest a turn resolves the plan too");
  await run(player, P.column, { partyId: party.id });
  await run(player, P.lockInColumn, { partyId: party.id, actorId: thief.id, value: "rest|" });
  before = await run(gm, P.state, { fid, partyId: party.id });
  check("the thief's rest is locked before the press", before.plan?.[thief.id]?.key === "rest" && before.plan[thief.id].resolvedTurn == null, before.plan);
  since = await run(gm, P.nowMs);
  const rested = await run(gm, P.pressTurn, { partyId: party.id, fid, turns: before.turns, action: "restTurn" });
  const afterRest = await run(gm, P.state, { fid, partyId: party.id });
  for (const c of await run(gm, P.cardsSince, { since })) tracked.push(gm.track(c.uuid, "ChatMessage"));
  check("Rest a turn spends exactly one turn and stamps the thief's rest with it", rested.advanced && afterRest.turns === before.turns + 1 && afterRest.plan?.[thief.id]?.key === "rest" && afterRest.plan[thief.id].resolvedTurn === afterRest.turns,
    { before: before.turns, after: afterRest.turns, plan: afterRest.plan });

  section("a fight cancels, on one card");
  await run(player, P.lockInColumn, { partyId: party.id, actorId: thief.id, value: "searchMethodical|" });
  await run(gm, P.gmLock, { fid, actorId: cleric.id, key: "listen" });
  st = await run(gm, P.state, { fid, partyId: party.id });
  check("two entries open before the fight", st.plan?.[thief.id]?.resolvedTurn == null && st.plan?.[cleric.id]?.key === "listen", st.plan);
  since = await run(gm, P.nowMs);
  const fight = await run(gm, P.fight, { fid, partyId: party.id });
  tracked.push(gm.track(fight.uuid, "Combat"));
  st = await run(gm, P.state, { fid, partyId: party.id });
  cards = await run(gm, P.cardsSince, { since });
  for (const c of cards) tracked.push(gm.track(c.uuid, "ChatMessage"));
  const interrupted = cards.filter((c) => c.rows.length === 2 && c.isPublic && c.rows.every((r) => ["QA Plan Thief", "QA Plan Cleric"].includes(r.name)));
  check("the fight deploys the party and clears both single-turn entries", fight.deployed && st.combat && !st.plan, { deployed: fight.deployed, plan: st.plan });
  check("one public group card names both", interrupted.length === 1, cards.map((c) => ({ title: c.title, rows: c.rows.length, isPublic: c.isPublic })));
  check("the fight is over when the combat goes", await run(gm, P.endFight, { fid, combatId: fight.id }));
  for (const c of await run(gm, P.cardsSince, { since })) tracked.push(gm.track(c.uuid, "ChatMessage"));

  section("Endurance is a capability, not a name");
  // Last, so the items it gives the fighter change no rest the steps above measure; swept at teardown.
  const endured = await run(gm, P.endurance, { actorId: fighter.id });
  for (const uuid of endured.made) tracked.push(gm.track(uuid, "Item"));
  note("endurance", { found: endured.found, before: endured.before, namedOnly: endured.namedOnly, imported: endured.imported });
  check("a gear item named for Endurance does not make its holder owe no rest", endured.before === false && endured.namedOnly === false, endured);
  check("the library's Endurance, carried, does: its definition id is the kw:endurance capability", endured.found && endured.imported === true, endured);

  section("errors after ready");
  await run(gm, P.closeSheet, { partyId: party.id });
  await run(player, P.closeSheet, { partyId: party.id });
  for (const [key, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${key} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors?.slice(0, 5));
  }
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try {
    if (open.gm) note("swept", await open.gm.sweepTracked({ only: unique(tracked) }));
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch { /* closed */ } }
}
