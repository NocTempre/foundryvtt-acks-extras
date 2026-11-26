/**
 * Live walk: docs/formation/TESTING.md "The crossing, Search here and the
 * Trapbreaking modifier on a Player seat" (T-0792 B3). A real Player seat that
 * owns a party member opens, sets up, throws for and ends the crossing (the
 * party actor's ownership), presses a member's Haul, landing save and footing
 * (the member's ownership), presses the Dungeon tab's Search here, and types the
 * Trapbreaking window's modifier; the Judge's seat reads every write back.
 *
 * WRITTEN FROM THE CODE AND NEVER RUN. No step has been observed live; the first
 * run is the first evidence, and a step that fails there is a finding about this
 * file as likely as about the module.
 *
 * Steps report under the recipe's ids: C1a to C1e and C11a to C11e (the crossing
 * as a whole), C12a to C12c (the water penalty), C13a to C13d (Haul, the landing
 * save, the footing), C14a to C14c (Search here), C18a to C18c (the Trapbreaking
 * modifier) and W1 (the wall sheet's trap row). A step the world cannot give is
 * printed as `NOT WALKED  <id>  <reason>`, which is neither a PASS nor a FAIL.
 *
 * Scripted, not gestured: every press is a real click on the seat's own open
 * sheet and every field a value typed the way a person leaves a field (input,
 * then change). A crafted press calls the module's own request function on the
 * seat's page. The die is rigged on the Judge's page, which runs every relay.
 * Nothing is printed that carries a user's name or a card's words: names and
 * tooltips are compared in the page and come back as booleans.
 *
 * Every name is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): `formation/crossing-seat-*` (a scene, a Region, a place linked
 * to it, a party with its token, a member the seat owns and one it does not, a
 * wall), `formation/heads-observed-*` (the seat at OBSERVER on the party actor and
 * on no member) and, for C18, the `formation/trapbreak-*` fixtures
 * formation-trapbreak.mjs builds and shapes. Deletes by the run's own ledger only:
 * the cards the presses post, tracked by id. The crossing flag, the scene search
 * session, the token's place, the die rig and the members' records are put back by
 * what the run wrote.
 *
 * Seats: the primary GM and a Player user (SEAT_PLAYER). The Judge's seat runs
 * every relay. No port, world, user name or password is written here: the driver
 * and `_env.mjs` supply them. No screenshot is taken.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const SCOPE = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0, skipped: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};
const notWalked = (id, reason) => {
  tally.skipped += 1;
  console.log(`NOT WALKED  ${id}  ${reason}`);
};

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__scBoot = { phase: "load", phases: [], errors: [] });
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
/*  A function closes over nothing but its argument and __sc.          */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    userId: game.user.id,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    playersMoveParty: !!game.settings.get("acks-extras", "playersMoveParty"),
    boot: globalThis.__scBoot ?? null,
  }),

  /** Import the modules the walk reads, add helpers, and record every notification the seat is shown. */
  install: async () => {
    const H = (globalThis.__sc = globalThis.__sc ?? {});
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
    H.requests = await import(`${base}formation/player-requests.mjs`);
    H.travel = await import(`${base}formation/travel.mjs`);
    H.crossing = await import(`${base}formation/crossing.mjs`);
    H.logic = await import(`${base}formation/crossing-logic.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.set = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    H.flag = (partyId) => game.actors.get(partyId)?.getFlag("acks-extras", "crossing") ?? null;
    if (!H.notes) {
      H.notes = [];
      for (const level of ["info", "warn", "error"]) {
        const original = ui.notifications[level].bind(ui.notifications);
        ui.notifications[level] = (message, options) => { H.notes.push({ level, text: String(message) }); return original(message, options); };
      }
    }
    return { ok: typeof H.requests.requestCrossingRun === "function" && typeof H.crossing.buildCrossingView === "function" };
  },

  notes: async () => globalThis.__sc.notes.splice(0, globalThis.__sc.notes.length),
  nowMs: async () => Date.now(),
  boot: async () => globalThis.__scBoot ?? null,
  loc: async ({ key, data = null }) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),
  userName: async ({ id }) => game.users.get(id)?.name ?? "",

  formationOf: async ({ partyId }) => {
    const H = globalThis.__sc;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  tokenData: async ({ actorId, xy }) => ({ ...(await game.actors.get(actorId).getTokenDocument({ x: xy.x, y: xy.y })).toObject() }),

  /** A party brought to its start shape: the members in order (added with no token), the seat owning `owned` and none of the others, the delve, no crossing. */
  shape: async ({ fid, members, owned = [], seatId, observedParty = null }) => {
    const H = globalThis.__sc;
    for (const id of members) {
      if (!H.model.getFormation(fid).members.some((m) => m?.actorId === id)) await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), null, { scene: null });
    }
    await H.model.patchFormation(fid, (rec) => { rec.members = members.map((id) => rec.members.find((m) => m?.actorId === id)).filter(Boolean); });
    for (const id of members) {
      await game.actors.get(id).update({ ownership: owned.includes(id) ? { default: 0, [seatId]: 3 } : { default: 0 } }, { diff: false, recursive: false });
    }
    if (H.travel.travelOf(H.model.getFormation(fid)).mode !== "delve") await H.travel.setJourneyMode(fid, "delve", { sceneId: null });
    const actor = game.actors.get(H.model.getFormation(fid).actorId);
    if (observedParty) await actor.update({ ownership: { default: 0, [seatId]: 2 } }, { diff: false, recursive: false });
    if (actor.getFlag("acks-extras", "crossing")) await actor.unsetFlag("acks-extras", "crossing");
    await H.sleep(700);
    return { mode: H.travel.travelOf(H.model.getFormation(fid)).mode, owner: actor.ownership?.[seatId] ?? 0 };
  },

  /** The Judge's own writes the walk uses to begin a crossing and to set a member's state to read. */
  begin: async ({ fid, kind, setup = null }) => {
    const H = globalThis.__sc;
    const f = H.model.getFormation(fid);
    const opened = await H.crossing.beginCrossing(f, kind);
    if (opened && setup) await game.actors.get(f.actorId).update(Object.fromEntries(Object.entries(setup).map(([k, v]) => [`flags.acks-extras.crossing.${k}`, v])));
    await H.sleep(500);
    return { opened: !!opened, id: H.flag(f.actorId)?.id ?? null };
  },
  end: async ({ fid }) => {
    const H = globalThis.__sc;
    const f = H.model.getFormation(fid);
    if (H.flag(f.actorId)) await H.crossing.endCrossing(f);
    await H.sleep(400);
    return { open: !!H.flag(f.actorId) };
  },
  member: async ({ partyId, actorId, record }) => {
    await game.actors.get(partyId).update({ [`flags.acks-extras.crossing.members.${actorId}`]: record });
    await globalThis.__sc.sleep(400);
    return { ok: true };
  },
  state: async ({ partyId }) => {
    const c = globalThis.__sc.flag(partyId);
    return c ? { open: true, id: c.id, kind: c.kind, judgeMod: c.judgeMod ?? null, judgeModBy: c.judgeModBy ?? null, penaltyPick: c.penaltyPick ?? null, penaltyLarger: c.penaltyLarger ?? null, shape: c.shape ?? null, gap: c.gap ?? null, members: Object.fromEntries(Object.entries(c.members ?? {}).map(([id, m]) => [id, { state: m.state ?? null, throws: m.throws ?? 0, footing: m.jump?.footing ?? null }])) } : { open: false };
  },
  /** Setup keys written onto the open crossing by the Judge's page, each by its own path. */
  setup: async ({ partyId, setup }) => {
    await game.actors.get(partyId).update(Object.fromEntries(Object.entries(setup).map(([k, v]) => [`flags.acks-extras.crossing.${k}`, v])));
    await globalThis.__sc.sleep(400);
    return { ok: true };
  },
  /** The state names the walk writes, read from the module's own constants. */
  names: async () => ({ drowning: globalThis.__sc.logic.DROWNING, afloat: globalThis.__sc.logic.SWIMMING }),

  rig: async ({ face = null, faces = 20 }) => {
    const H = globalThis.__sc;
    H.native ??= CONFIG.Dice.randomUniform;
    if (face === null) { CONFIG.Dice.randomUniform = H.native; return { native: true }; }
    CONFIG.Dice.randomUniform = () => (faces - face + 0.5) / faces;
    return { native: false, got: (await new Roll(`1d${faces}`).evaluate()).total };
  },

  cards: async ({ since }) => game.messages.contents
    .filter((m) => m.timestamp >= since)
    .map((m) => ({ id: m.id, alias: m.speaker?.alias ?? "", whispered: (m.whisper ?? []).length > 0, formula: m.rolls?.[0]?.formula ?? null, total: m.rolls?.[0]?.total ?? null, natural: m.rolls?.[0]?.dice?.[0]?.results?.[0]?.result ?? null }))
    ,

  /** Open a party sheet on this seat at its mode tab. */
  open: async ({ partyId, width = 920, height = 860 }) => {
    const H = globalThis.__sc;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(1000);
    app.setPosition({ left: 16, top: 16, width, height });
    H.root(app)?.querySelector('.tabs [data-group="primary"][data-tab="mode"]')?.click();
    await H.sleep(700);
    return { id: app.id };
  },
  close: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** The sheet's own seat object, redrawn first. */
  seat: async ({ partyId }) => {
    const app = game.actors.get(partyId).sheet;
    await app.render();
    await globalThis.__sc.sleep(600);
    return (await app._prepareContext({})).seat ?? null;
  },

  /** What the crossing section draws on this seat. */
  xview: async ({ partyId }) => {
    const H = globalThis.__sc;
    const el = H.root(game.actors.get(partyId).sheet);
    const sec = el?.querySelector(".acks-extras-crossing");
    const rows = [...(sec?.querySelectorAll(".acks-extras-crossing-row") ?? [])].map((li) => {
      const q = (sel) => li.querySelector(sel);
      const id = li.dataset.pressHome ?? null;
      return { id, throw: !!q('[data-action="crossingThrow"]'), haul: !!q('[data-action="crossingHaul"]'), land: !!q('[data-action="crossingLand"]'), failed: !!q('[data-action="crossingLandingFailed"]'), attempt: !!q('[data-action="crossingAttempt"]') };
    });
    return {
      section: !!sec,
      kindSelect: !!sec?.querySelector('[data-pick="crossing-kind"]'),
      begin: !!sec?.querySelector('[data-action="crossingBegin"]'),
      setup: [...(sec?.querySelectorAll(".acks-extras-crossing-setup [name]") ?? [])].map((c) => c.getAttribute("name")),
      inForce: !!sec?.querySelector(".acks-extras-crossing-inforce"),
      throwAll: !!sec?.querySelector('[data-action="crossingThrowAll"]'),
      end: !!sec?.querySelector('[data-action="crossingEnd"]'),
      rows,
    };
  },

  /** A form field of the open sheet: its value, its options and whether it is disabled. */
  field: async ({ partyId, name }) => {
    const c = globalThis.__sc.root(game.actors.get(partyId).sheet)?.querySelector(`[name="${name}"]`);
    return c ? { found: true, value: c.type === "checkbox" ? !!c.checked : c.value, disabled: !!c.disabled, options: [...(c.options ?? [])].map((o) => o.value) } : { found: false };
  },
  /** A field typed into as a person does. */
  type: async ({ partyId, name, value, settle = 2200 }) => {
    const H = globalThis.__sc;
    const c = H.root(game.actors.get(partyId).sheet)?.querySelector(`[name="${name}"]`);
    if (!c) return { found: false };
    H.notes.length = 0;
    H.set(c, value);
    await H.sleep(settle);
    return { found: true };
  },
  /** A real click on a control of the open sheet; with `pick`, the begin row's kind select is set first. */
  click: async ({ partyId, selector, pick = null, settle = 2500 }) => {
    const H = globalThis.__sc;
    const root = H.root(game.actors.get(partyId).sheet);
    if (pick) { const s = root?.querySelector('[data-pick="crossing-kind"]'); if (s) H.set(s, pick); }
    const control = root?.querySelector(selector);
    if (!control) return { found: false, selector };
    const disabled = !!control.disabled;
    H.notes.length = 0;
    control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },
  /** The footing pick set on a row, then its Failed press. */
  footing: async ({ partyId, actorId, value, settle = 2500 }) => {
    const H = globalThis.__sc;
    const li = H.root(game.actors.get(partyId).sheet)?.querySelector(`.acks-extras-crossing-row[data-press-home="${actorId}"]`);
    const sel = li?.querySelector('[data-pick="crossing-footing"]');
    const btn = li?.querySelector('[data-action="crossingLandingFailed"]');
    if (!sel || !btn) return { found: false };
    H.set(sel, value);
    H.notes.length = 0;
    btn.click();
    await H.sleep(settle);
    return { found: true };
  },
  /** The Roll press on a row, with every dialog either seat opens counted and closed so nothing waits on one. */
  land: async ({ partyId, actorId, settle = 4000 }) => {
    const H = globalThis.__sc;
    const dialogs = () => [...document.querySelectorAll(".application.dialog, dialog.dialog")];
    const before = dialogs().length;
    const btn = H.root(game.actors.get(partyId).sheet)?.querySelector(`.acks-extras-crossing-row[data-press-home="${actorId}"] [data-action="crossingLand"]`);
    if (!btn) return { found: false };
    H.notes.length = 0;
    btn.click();
    await H.sleep(settle);
    return { found: true, opened: Math.max(0, dialogs().length - before) };
  },
  /** Dialogs standing on this seat now, closed (a save dialog on the Judge's screen would hold the relay). */
  strayDialogs: async () => {
    const open = [...document.querySelectorAll(".application.dialog, dialog.dialog")];
    for (const d of open) d.querySelector('button[data-action="close"], .header-control.close')?.click();
    return { n: open.length };
  },

  /** Whether a field's tooltip names who set the Judge's modifier: the name's words, or the Judge's. Compared here, never printed. */
  setBy: async ({ partyId, userId, expectJudge }) => {
    const H = globalThis.__sc;
    const label = H.root(game.actors.get(partyId).sheet)?.querySelector('input[name="crossing.judgeMod"]')?.closest("label");
    const tip = label?.dataset.tooltipText ?? "";
    const want = expectJudge
      ? game.i18n.localize("ACKS-FORMATION.crossing.judgeModByJudge")
      : game.i18n.format("ACKS-FORMATION.crossing.judgeModBy", { name: game.users.get(userId)?.name ?? "" });
    return { found: !!label, matches: tip === want };
  },
  /** Whether a notification the seat was shown has the words of a lang key (optionally with data). */
  said: async ({ key, data = null, level = "warn" }) => {
    const want = data ? game.i18n.format(key, data) : game.i18n.localize(key);
    return { said: globalThis.__sc.notes.some((n) => n.level === level && n.text === want) };
  },

  /** A crafted `crossingRun` or `crossing` request from this seat's page, which the Judge's client checks again. */
  craft: async ({ fid, type, payload }) => globalThis.__sc.requests.requestPartyAction(fid, type, payload, { sent: false }),
  /** A crafted party press from this seat's page. */
  press: async ({ fid, press, args = {} }) => globalThis.__sc.requests.requestPartyAction(fid, "partyPress", { press, args }, { sent: false }),

  /** The scene search flag on the party actor: open, shown and each lot's found mark. */
  session: async ({ partyId }) => {
    const f = game.actors.get(partyId)?.getFlag("acks-extras", "sceneSearch") ?? null;
    return f ? { open: true, shown: f.shown === true, placeUuid: f.placeUuid ?? null, lots: (f.lots ?? []).map((l) => ({ found: l.found === true })) } : { open: false };
  },
  endSession: async ({ fid }) => {
    try { const r = await acksExtras.sceneSearch.end(fid); return { ok: r?.ok === true }; } catch (_e) { return { ok: false }; }
  },
  /** The scene search's own windows standing on this seat. */
  searchWindows: async () => [...foundry.applications.instances.values()].filter((a) => /scene-?search/i.test(`${a.id ?? ""} ${a.constructor?.name ?? ""}`)).length,
  tooltipKey: async ({ partyId, selector }) => globalThis.__sc.root(game.actors.get(partyId).sheet)?.querySelector(selector)?.dataset.tooltip ?? null,

  moveToken: async ({ fid, xy }) => {
    const H = globalThis.__sc;
    const tok = H.model.getPartyToken(H.model.getFormation(fid));
    if (!tok) return { ok: false };
    await tok.update({ x: xy.x, y: xy.y }, { animate: false, "acks-extras.poiTravel": true });
    await H.sleep(600);
    return { ok: true };
  },
  linkPlace: async ({ regionUuid, placeId }) => {
    const S = globalThis.acksExtras?.location?.scenes;
    if (!S?.linkRegion || !S?.locationOfRegion) return { error: "no location api" };
    const region = fromUuidSync(regionUuid);
    const place = game.actors.get(placeId);
    if (S.locationOfRegion(region)?.uuid !== place.uuid) await S.linkRegion(region, place);
    return { linked: S.locationOfRegion(region)?.uuid === place.uuid };
  },

  /** The Trapbreaking window for a party and character on this seat: whether the modifier field and the Judge's controls are drawn, and what the modifier's tooltip is. */
  tbOpen: async ({ fid, actorId, targetUuid = null }) => {
    const H = globalThis.__sc;
    H.app ??= await import("/modules/acks-extras/scripts/formation/trapbreak-app.mjs");
    const f = H.model.getFormation(fid);
    await H.app.openTrapbreakApp(f.id, actorId, targetUuid ? { targetUuid } : null);
    const win = foundry.applications.instances.get(H.app.trapbreakWindowId(fid, actorId));
    await H.poll(() => (win?.rendered && H.root(win)?.querySelector('[data-action="attempt"]') ? true : null), { tries: 60, every: 150 });
    return { open: !!win?.rendered };
  },
  tbRead: async ({ fid, actorId }) => {
    const H = globalThis.__sc;
    const win = foundry.applications.instances.get(H.app.trapbreakWindowId(fid, actorId));
    const root = H.root(win);
    const input = root?.querySelector('input[name="extra"]');
    return {
      open: !!win,
      field: !!input,
      tip: input?.dataset.tooltip ?? null,
      markFound: !!root?.querySelector('[data-action="markFound"]'),
      reset: !!root?.querySelector('[data-action="resetTrap"]'),
      attemptEnabled: root?.querySelector('[data-action="attempt"]')?.disabled === false,
    };
  },
  tbType: async ({ fid, actorId, value }) => {
    const H = globalThis.__sc;
    const input = H.root(foundry.applications.instances.get(H.app.trapbreakWindowId(fid, actorId)))?.querySelector('input[name="extra"]');
    if (!input) return { found: false };
    H.set(input, value);
    await H.sleep(800);
    return { found: true };
  },
  tbAttempt: async ({ fid, actorId, settle = 3500 }) => {
    const H = globalThis.__sc;
    const btn = H.root(foundry.applications.instances.get(H.app.trapbreakWindowId(fid, actorId)))?.querySelector('[data-action="attempt"]');
    if (!btn || btn.disabled) return { found: !!btn, disabled: !!btn?.disabled };
    btn.click();
    await H.sleep(settle);
    return { found: true, disabled: false };
  },
  tbClose: async ({ fid, actorId }) => {
    const H = globalThis.__sc;
    try { await foundry.applications.instances.get(H.app?.trapbreakWindowId(fid, actorId))?.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** The wall's configuration sheet on this seat: whether the trap row is drawn, and whether Foundry lets this seat write the trap onto it. */
  wallRow: async ({ wallUuid }) => {
    const H = globalThis.__sc;
    const wall = await fromUuid(wallUuid);
    const can = !!wall.canUserModify(game.user, "update", { flags: { "acks-extras": { trap: {} } } });
    const app = new foundry.applications.sheets.WallConfig({ document: wall });
    await app.render({ force: true });
    await H.sleep(1200);
    const row = !!H.root(app)?.querySelector(".acks-extras-trap-drop");
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return { can, row };
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Run a page function on a seat until its answer passes `test`, or give back the last answer. */
const until = async (api, fn, arg, test, { tries = 40, every = 250 } = {}) => {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, arg);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
};

const ready = async (api, label) => {
  for (let n = 0; n < 240; n++) {
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
    const id = ++next + 700000;
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

const open = {};
const cardIds = [];
const held = { partyIds: [], fids: [], tokenHome: null, rigged: false, trapbreak: null, sessionFid: null };
const character = (name, ownership) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } }, ...(ownership ? { ownership } : {}) });

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("seat ready after (s)", await record(PORTS.player, "seat", player));
  note("installed", [await run(gm, P.install), await run(player, P.install)]);
  const census = { gm: await run(gm, P.census), seat: await run(player, P.census) };
  if (census.seat.role !== 1) blocked(`the seat's role is ${census.seat.role}; the walk is for a Player (1) seat`);
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the relay would run there");
  check("the Judge's seat is a GM, the active one, and the other seat a Player", census.gm.role >= 3, { gm: census.gm.role, seat: census.seat.role });
  for (const [key, c] of Object.entries(census)) check(`${key}: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  const seatId = census.seat.userId;
  const gmId = census.gm.userId;
  const yours = { default: 0, [seatId]: 3 };
  const names = await run(gm, P.names);
  const L = (key, data) => run(gm, P.loc, { key, data });
  // Under `playersMoveParty` a seat that owns no member owns the party actor too, so the not-owner legs read that setting first.
  note("playersMoveParty (read, never written)", census.gm.playersMoveParty);

  /* ------------------------------ fixtures ------------------------------ */
  section("fixtures");
  const scene = await gm.fixture("formation/crossing-seat-scene", "Scene", { name: "QA Crossing Seat Scene", width: 1600, height: 1000, grid: { size: 100 }, ownership: { default: 2 } });
  const region = await gm.fixture("formation/crossing-seat-region", "Region", { name: "QA Crossing Seat Region", color: "#336699", shapes: [{ type: "rectangle", x: 100, y: 100, width: 600, height: 600, rotation: 0, hole: false }], behaviors: [] }, { parent: scene.uuid });
  const place = await gm.fixture("formation/crossing-seat-place", "Actor", { name: "QA Crossing Seat Place", type: `${SCOPE}.location` });
  const party = await gm.fixture("formation/crossing-seat-party", "Actor", { name: "QA Crossing Seat Party", type: `${SCOPE}.party` });
  const a = await gm.fixture("formation/crossing-seat-a", "Actor", character("QA Crossing Seat A", yours));
  const b = await gm.fixture("formation/crossing-seat-b", "Actor", character("QA Crossing Seat B"));
  await gm.fixture("formation/crossing-seat-token", "Token", await run(gm, P.tokenData, { actorId: party.id, xy: { x: 300, y: 300 } }), { parent: scene.uuid });
  const wall = await gm.fixture("formation/crossing-seat-wall", "Wall", { c: [900, 200, 900, 600], move: 0, sight: 0, sound: 0, light: 0 }, { parent: scene.uuid });
  const observed = {
    party: await gm.fixture("formation/heads-observed-party", "Actor", { name: "QA Heads Observed Party", type: `${SCOPE}.party` }),
    member: await gm.fixture("formation/heads-observed-member", "Actor", character("QA Heads Observed Member")),
  };
  held.partyIds = [party.id, observed.party.id];
  const fids = {};
  for (const [key, p] of Object.entries({ main: party, observed: observed.party })) {
    const f = await run(gm, P.formationOf, { partyId: p.id });
    if (f.error) throw new Error(`${key}: ${f.error}`);
    fids[key] = f.fid;
  }
  held.fids = [fids.main, fids.observed];
  held.sessionFid = fids.main;
  const linked = await run(gm, P.linkPlace, { regionUuid: region.uuid, placeId: place.id });
  if (linked.error) notWalked("C14", `the place link is unavailable: ${linked.error}`);
  note("fixtures", { party: party.uuid, scene: scene.uuid, region: region.uuid, place: place.uuid, observed: observed.party.uuid });

  const since = await run(gm, P.nowMs);
  const shapeMain = () => run(gm, P.shape, { fid: fids.main, members: [a.id, b.id], owned: [a.id], seatId });
  const shapeObserved = () => run(gm, P.shape, { fid: fids.observed, members: [observed.member.id], owned: [], seatId, observedParty: true });
  const press = (api, partyId, selector, o = {}) => run(api, P.click, { partyId, selector, ...o });
  const state = () => run(gm, P.state, { partyId: party.id });
  const view = () => run(player, P.xview, { partyId: party.id });
  const rowOf = (v, id) => v.rows.find((r) => r.id === id) ?? null;
  const reopen = async () => { await run(player, P.open, { partyId: party.id }); return run(player, P.seat, { partyId: party.id }); };

  /* ------------------------------- C1: Begin, setup ------------------------------- */
  section("C1. The crossing as a whole: Begin and the setup");
  const s0 = await shapeMain();
  check("C1 start shape: the delve, the seat owning member A and so the party actor, no crossing open", s0.mode === "delve" && s0.owner === 3 && !(await state()).open, s0);
  const seat1 = await reopen();
  const v1 = await view();
  check("C1a with no crossing open the Player's section shows the kind pick and Begin", seat1?.ownsParty === true && seat1?.isGM === false && v1.section && v1.kindSelect && v1.begin, { seat: seat1, view: v1 });

  const b1 = await press(player, party.id, '[data-action="crossingBegin"]', { pick: "swim" });
  const st1 = await until(gm, P.state, { partyId: party.id }, (x) => x.open);
  check("C1b Begin (swim) pressed on the Player's seat opens the flag, read on the Judge's seat", b1.found && st1.open && st1.kind === "swim", { found: b1.found, kind: st1.kind });
  const begun = (await run(gm, P.cards, { since })).filter((c) => c.alias === party.name && !c.whispered);
  check("C1b one public line, spoken as the party, announces the Begin press", begun.length >= 1, { lines: begun.length });

  await run(player, P.open, { partyId: party.id });
  const v1b = await view();
  check("C1c the Player's section holds the setup fields (the Judge's modifier among them)", v1b.setup.includes("crossing.judgeMod") && v1b.setup.includes("crossing.penaltyPick"), v1b.setup);
  await run(player, P.type, { partyId: party.id, name: "crossing.judgeMod", value: "2" });
  const mod = await until(gm, P.state, { partyId: party.id }, (x) => x.judgeMod === 2);
  check("C1c a modifier typed on the Player's seat lands on the flag from that client, with the setter's id beside it", mod.judgeMod === 2 && mod.judgeModBy === seatId, { judgeMod: mod.judgeMod, bySeat: mod.judgeModBy === seatId });
  await run(player, P.open, { partyId: party.id });
  const tipP = await run(player, P.setBy, { partyId: party.id, userId: seatId, expectJudge: false });
  check("C1c the modifier's tooltip says who set it (the Player's name)", tipP.found && tipP.matches, tipP);
  await run(gm, P.open, { partyId: party.id });
  await run(gm, P.type, { partyId: party.id, name: "crossing.judgeMod", value: "1" });
  const modJ = await until(gm, P.state, { partyId: party.id }, (x) => x.judgeMod === 1);
  check("C1d the Judge's own entry replaces it and names the Judge's id", modJ.judgeMod === 1 && modJ.judgeModBy === gmId, { judgeMod: modJ.judgeMod, byGm: modJ.judgeModBy === gmId });
  const tipJ = await run(gm, P.setBy, { partyId: party.id, userId: gmId, expectJudge: true });
  check("C1d the tooltip now reads \"Set by the Judge\"", tipJ.found && tipJ.matches, tipJ);
  await run(gm, P.type, { partyId: party.id, name: "crossing.judgeMod", value: "0" });
  const modZ = await until(gm, P.state, { partyId: party.id }, (x) => x.judgeMod === 0 && x.judgeModBy === null);
  check("C1e a blanked modifier clears the setter with it", modZ.judgeMod === 0 && modZ.judgeModBy === null, { judgeMod: modZ.judgeMod, by: modZ.judgeModBy });
  await run(gm, P.close, { partyId: party.id });

  /* ------------------------------- C12: the water penalty ------------------------------- */
  section("C12. The water penalty");
  await run(player, P.open, { partyId: party.id });
  const pick = await run(player, P.field, { partyId: party.id, name: "crossing.penaltyPick" });
  const stepPick = (pick.options ?? []).find((o) => o !== "none" && o !== "larger") ?? null;
  if (!stepPick) notWalked("C12a (an imported step)", "the pick offers no imported size: the Rules tables import is absent");
  else {
    await run(player, P.type, { partyId: party.id, name: "crossing.penaltyPick", value: stepPick });
    const r = await until(gm, P.state, { partyId: party.id }, (x) => x.penaltyPick === stepPick);
    check("C12a an imported penalty step picked on the Player's seat lands on the flag", r.penaltyPick === stepPick, { picked: stepPick, flag: r.penaltyPick });
  }
  await run(player, P.open, { partyId: party.id });
  await run(player, P.type, { partyId: party.id, name: "crossing.penaltyPick", value: "larger" });
  await run(player, P.open, { partyId: party.id });
  await run(player, P.type, { partyId: party.id, name: "crossing.penaltyLarger", value: "7" });
  const larger = await until(gm, P.state, { partyId: party.id }, (x) => x.penaltyPick === "larger" && x.penaltyLarger === 7);
  check("C12a Larger, and a figure typed beside it, both land on the flag", larger.penaltyPick === "larger" && larger.penaltyLarger === 7, { pick: larger.penaltyPick, larger: larger.penaltyLarger });
  await run(player, P.open, { partyId: party.id });
  const v12 = await view();
  check("C12b the in-force line is not drawn where the pick is", !v12.inForce && v12.setup.includes("crossing.penaltyPick"), { inForce: v12.inForce });

  /* ------------------------------- C12c: a seat that views and does not own ------------------------------- */
  section("C12c. A seat that views the party and does not own it");
  const so = await shapeObserved();
  await run(gm, P.begin, { fid: fids.observed, kind: "swim" });
  await run(player, P.open, { partyId: observed.party.id });
  const seatO = await run(player, P.seat, { partyId: observed.party.id });
  if (seatO?.ownsParty !== false) notWalked("C12c", `the observed party's actor reads ownsParty ${seatO?.ownsParty} on the Player's seat: Foundry's ownership sync rewrote the OBSERVER grant (owner level ${so.owner}), so no such seat survives; the in-force line is covered offline only`);
  else {
    const vo = await run(player, P.xview, { partyId: observed.party.id });
    check("C12c a seat that does not own the party actor reads the penalty in force and holds no setup field, no Begin, no End", vo.section && vo.inForce && vo.setup.length === 0 && !vo.begin && !vo.end && !vo.throwAll, vo);
  }
  await run(gm, P.end, { fid: fids.observed });
  await run(player, P.close, { partyId: observed.party.id });

  /* ------------------------------- C11a: Throw all ------------------------------- */
  section("C11a. Throw all throws for the members the seat owns");
  await shapeMain();
  await run(gm, P.begin, { fid: fids.main, kind: "swim" });
  await run(gm, P.rig, { face: 20 });
  held.rigged = true;
  await run(player, P.open, { partyId: party.id });
  const v11 = await view();
  const aRow = rowOf(v11, a.id);
  const bRow = rowOf(v11, b.id);
  const before11 = await state();
  if (!v11.throwAll || !aRow?.throw) notWalked("C11a", `Throw all is not drawn on the Player's seat or A has no throw (throwAll ${v11.throwAll}, A throw ${aRow?.throw}): the swim figures are not imported`);
  else {
    await press(player, party.id, '[data-action="crossingThrowAll"]');
    const after11 = await until(gm, P.state, { partyId: party.id }, (x) => (x.members[a.id]?.throws ?? 0) > (before11.members[a.id]?.throws ?? 0));
    check("C11a Throw all on the Player's seat throws for A", (after11.members[a.id]?.throws ?? 0) > (before11.members[a.id]?.throws ?? 0), { before: before11.members[a.id], after: after11.members[a.id] });
    check("C11a B's record is untouched", JSON.stringify(after11.members[b.id] ?? null) === JSON.stringify(before11.members[b.id] ?? null), { b: after11.members[b.id] ?? null });
    if (!bRow?.throw) note("B's own row offers the Judge no throw either, so the B leg proves less than it says", { bThrow: bRow?.throw });
  }
  await run(gm, P.rig, { face: null });
  held.rigged = false;

  /* ------------------------------- C13a, C11b to C11d: Haul and End ------------------------------- */
  section("C13a and C11b to C11d. Haul and End with a member held");
  await run(gm, P.end, { fid: fids.main });
  await shapeMain();
  const opened = await run(gm, P.begin, { fid: fids.main, kind: "swim" });
  for (const id of [a.id, b.id]) await run(gm, P.member, { partyId: party.id, actorId: id, record: { state: names.drowning, covered: 0, throws: 1, drownedRounds: 1 } });
  await run(player, P.open, { partyId: party.id });
  const v13 = await view();
  check("C13a with A and B drowning, Haul shows on A's row and not on B's", rowOf(v13, a.id)?.haul === true && rowOf(v13, b.id)?.haul === false, { a: rowOf(v13, a.id)?.haul, b: rowOf(v13, b.id)?.haul });
  const endHeld = await press(player, party.id, '[data-action="crossingEnd"]');
  const heldNote = await run(player, P.said, { key: "ACKS-FORMATION.crossing.endRefused.drowning", data: { names: `${a.name}, ${b.name}` } });
  const stateHeld = await state();
  check("C11b End on the Player's seat is refused while a member is drowning: the crossing stays open", endHeld.found && stateHeld.open && stateHeld.id === opened.id, { open: stateHeld.open, same: stateHeld.id === opened.id });
  check("C11b the seat is told, naming the members held", heldNote.said === true, heldNote);
  const crafted = await run(player, P.craft, { fid: fids.main, type: "crossingRun", payload: { step: "end", crossingId: opened.id } });
  check("C11b a crafted End from the Player's page is refused as held, and the crossing is still open", crafted?.ok === false && crafted?.refused === "held" && (await state()).open, crafted);
  await press(player, party.id, '[data-action="crossingHaul"][data-actor-id="' + a.id + '"]');
  const hauled = await until(gm, P.state, { partyId: party.id }, (x) => x.members[a.id]?.state === names.afloat);
  check("C13a pressing Haul on A sets A afloat, read on the Judge's seat, and leaves B drowning", hauled.members[a.id]?.state === names.afloat && hauled.members[b.id]?.state === names.drowning, { a: hauled.members[a.id]?.state, b: hauled.members[b.id]?.state });
  const hauledB = await run(player, P.craft, { fid: fids.main, type: "crossing", payload: { crossingId: opened.id, actorId: b.id, step: "haul" } });
  check("C13a a crafted Haul for B (not the seat's) is refused and B stays drowning", hauledB?.ok === false && (await state()).members[b.id]?.state === names.drowning, hauledB);
  await run(gm, P.member, { partyId: party.id, actorId: b.id, record: { state: names.afloat, covered: 0, throws: 1, drownedRounds: 0 } });
  await run(player, P.open, { partyId: party.id });
  await press(player, party.id, '[data-action="crossingEnd"]');
  const closed = await until(gm, P.state, { partyId: party.id }, (x) => !x.open);
  check("C11c with both afloat the Player's End closes the crossing", !closed.open, closed);
  await run(gm, P.begin, { fid: fids.main, kind: "swim" });
  await run(gm, P.member, { partyId: party.id, actorId: a.id, record: { state: names.drowning, covered: 0, throws: 1, drownedRounds: 1 } });
  await run(gm, P.open, { partyId: party.id });
  await press(gm, party.id, '[data-action="crossingEnd"]');
  const closedJ = await until(gm, P.state, { partyId: party.id }, (x) => !x.open);
  check("C11d the Judge's own End, with a member still drowning, is warned and goes ahead: the crossing closes", !closedJ.open, closedJ);
  await run(gm, P.close, { partyId: party.id });

  /* ------------------------------- C11e: the squeeze Shape ------------------------------- */
  section("C11e. The squeeze Shape");
  await run(player, P.open, { partyId: party.id });
  await press(player, party.id, '[data-action="crossingBegin"]', { pick: "squeeze" });
  const sq = await until(gm, P.state, { partyId: party.id }, (x) => x.open && x.kind === "squeeze");
  check("C11e a squeeze begun on the Player's seat", sq.open && sq.kind === "squeeze", sq);
  await run(player, P.open, { partyId: party.id });
  await press(player, party.id, '[name="crossing.shape"][value="squeeze"]');
  const shapeNow = await until(gm, P.state, { partyId: party.id }, (x) => x.shape === "squeeze");
  check("C11e the Shape radio on the Player's seat lands on the flag", shapeNow.shape === "squeeze", { shape: shapeNow.shape });
  await run(gm, P.end, { fid: fids.main });

  /* ------------------------------- C13b to C13d: the landing save and the footing ------------------------------- */
  section("C13b to C13d. The landing save and the footing");
  const jump = await run(gm, P.begin, { fid: fids.main, kind: "jump", setup: { gap: 5, precarious: true, runUp: true } });
  await run(player, P.open, { partyId: party.id });
  const vj = await view();
  const aJ = rowOf(vj, a.id);
  const bJ = rowOf(vj, b.id);
  if (!jump.opened || !aJ?.land) notWalked("C13b", `A's row carries no Roll press (land ${aJ?.land}, failed ${aJ?.failed}): the jumping figures are not imported, or the landing is not asked for`);
  else {
    check("C13b the landing's Roll press is on A's row and not on B's", aJ.land && !bJ?.land, { a: aJ.land, b: bJ?.land });
    const stBefore = await state();
    const cards0 = (await run(gm, P.cards, { since: Date.now() - 1 })).length;
    const out = await run(player, P.land, { partyId: party.id, actorId: a.id });
    const strayGm = await run(gm, P.strayDialogs);
    const strayPlayer = await run(player, P.strayDialogs);
    note("cards seen before the press", cards0);
    check("C13b the save rolls on the Judge's client with no dialog opening on either screen", out.found && out.opened === 0 && strayGm.n === 0 && strayPlayer.n === 0, { playerOpened: out.opened, gmStanding: strayGm.n, playerStanding: strayPlayer.n });
    const stAfter = await state();
    check("C13b the roll writes nothing to the crossing's flag", JSON.stringify(stAfter.members) === JSON.stringify(stBefore.members), {});
    const landed = (await run(gm, P.cards, { since })).filter((c) => c.alias === party.name && c.whispered);
    check("C13b a card to the Judges records the landing", landed.length >= 1, { whispers: landed.length });
  }
  // The footing is written on a member who has attempted: seed that record from the Judge's page, never from a press.
  await run(gm, P.member, { partyId: party.id, actorId: a.id, record: { state: "landing", covered: 0, throws: 1, jump: { face: 3, distance: 6, gap: 5, clears: true, save: null, slip: null, footing: null } } });
  await run(player, P.open, { partyId: party.id });
  const vf = rowOf(await view(), a.id);
  if (!vf?.failed) notWalked("C13c", "A's row carries no footing pick: the landing is not asked for in this world");
  else {
    await run(player, P.footing, { partyId: party.id, actorId: a.id, value: "edge" });
    const wrote = await until(gm, P.state, { partyId: party.id }, (x) => x.members[a.id]?.footing === "edge");
    check("C13c a footing picked and Failed pressed on the Player's seat writes jump.footing on A's record", wrote.members[a.id]?.footing === "edge", { footing: wrote.members[a.id]?.footing, state: wrote.members[a.id]?.state });
    const crafted13 = await run(player, P.craft, { fid: fids.main, type: "crossing", payload: { crossingId: jump.id, actorId: b.id, step: "footing", footing: "solid" } });
    check("C13c a crafted footing for B is refused and B's record is untouched", crafted13?.ok === false && (await state()).members[b.id]?.footing == null, crafted13);
    const craftedBad = await run(player, P.craft, { fid: fids.main, type: "crossing", payload: { crossingId: jump.id, actorId: a.id, step: "footing", footing: "nowhere" } });
    check("C13c a footing outside the closed set is refused", craftedBad?.ok === false, craftedBad);
  }
  // A gap past every range makes the Judge's reading of the row warn, so the Player is blocked: no Roll press, and the footing is refused in words.
  await run(gm, P.member, { partyId: party.id, actorId: a.id, record: { state: "landing", covered: 0, throws: 1, jump: { face: 3, distance: 6, gap: 900, clears: false, save: null, slip: null, footing: null } } });
  await run(gm, P.setup, { partyId: party.id, setup: { gap: 900, precarious: true } });
  await run(player, P.open, { partyId: party.id });
  const vw = rowOf(await view(), a.id);
  if (!vw) notWalked("C13d", "no row for A");
  else {
    check("C13d where the Judge's reading of the landing would warn, the Player's row carries no Roll press", vw.land === false, { land: vw.land, failed: vw.failed });
    const refusedFooting = await run(player, P.craft, { fid: fids.main, type: "crossing", payload: { crossingId: (await state()).id, actorId: a.id, step: "footing", footing: "solid" } });
    check("C13d the footing press the row still draws is refused on the Judge's client, and nothing is written", refusedFooting?.ok === false, refusedFooting);
  }
  await run(gm, P.end, { fid: fids.main });

  /* ------------------------------- C14: Search here ------------------------------- */
  section("C14. Search here");
  await shapeMain();
  await run(gm, P.moveToken, { fid: fids.main, xy: { x: 300, y: 300 } });
  held.tokenHome = { x: 300, y: 300 };
  await run(gm, P.endSession, { fid: fids.main });
  await run(player, P.open, { partyId: party.id });
  const tip = await run(player, P.tooltipKey, { partyId: party.id, selector: '[data-action="searchHere"]' });
  check("C14a Search here is drawn on the Player's seat with the open tooltip (the Judge's wording)", tip === "ACKS-FORMATION.plan.searchHereTip", { tip });
  if (linked.error) notWalked("C14a (the press)", "no place under the party: the location api is unavailable");
  else {
    await press(player, party.id, '[data-action="searchHere"]', { settle: 3500 });
    const ses = await until(gm, P.session, { partyId: party.id }, (x) => x.open);
    check("C14a the press opens a scene search session at the place, read on the Judge's seat", ses.open && !!ses.placeUuid, { open: ses.open, place: !!ses.placeUuid });
    check("C14a the session opens with every lot unfound and the scene not shown to the table", ses.open && ses.shown === false && ses.lots.every((l) => l.found === false), { shown: ses.shown, lots: ses.lots.length });
    note("a pot dealt for fallen bodies is not walked here: Search here carries no fight's record, so no bodies are named", ses.lots.length);
    notWalked("C14a (the pot dealt for fallen bodies)", "needs the fallen bodies treasure-search builds; this walk presses Search here with no fight's record");
    const winPlayer = await run(player, P.searchWindows);
    check("C14a the Player's seat has no scene search screen open", winPlayer === 0, { windows: winPlayer });
    const lines = (await run(gm, P.cards, { since })).filter((c) => c.alias === party.name && !c.whispered);
    check("C14a the press is announced to the table, spoken as the party", lines.length >= 1, { lines: lines.length });
    await run(gm, P.endSession, { fid: fids.main });
    await until(gm, P.session, { partyId: party.id }, (x) => !x.open);

    await run(gm, P.moveToken, { fid: fids.main, xy: { x: 1300, y: 800 } });
    await run(player, P.open, { partyId: party.id });
    await press(player, party.id, '[data-action="searchHere"]', { settle: 3000 });
    const none = await run(gm, P.session, { partyId: party.id });
    const told = await run(player, P.said, { key: "ACKS-FORMATION.request.searchClosed" });
    check("C14b pressed with no place under the party, nothing opens", none.open === false, none);
    check("C14b the Player's seat is shown formation's refusal, \"The search did not open.\"", told.said, told);
    await run(gm, P.moveToken, { fid: fids.main, xy: { x: 300, y: 300 } });
  }
  const so14 = await shapeObserved();
  const denied = await run(player, P.press, { fid: fids.observed, press: "searchHere" });
  const noSession = await run(gm, P.session, { partyId: observed.party.id });
  if (census.gm.playersMoveParty) notWalked("C14c", "playersMoveParty is on in this world; the not-owner legs read ownership the setting changes");
  else check("C14c a crafted Search here from a seat that owns no member of that party answers notOwner and opens nothing", denied?.ok === false && denied?.refused === "notOwner" && noSession.open === false, { answer: denied, session: noSession.open, ownerLevel: so14.owner });

  /* ------------------------------- C18: the Trapbreaking modifier ------------------------------- */
  section("C18. The Trapbreaking modifier");
  const tbParty = await gm.eval(`game.actors.find((x) => x.flags?.world?.fixture === "formation/trapbreak-party")?.id ?? null`);
  const tbFighter = await gm.eval(`game.actors.find((x) => x.flags?.world?.fixture === "formation/trapbreak-fighter")?.id ?? null`);
  const tbWall = await gm.eval(`(game.scenes.find((s) => s.walls.some((w) => w.flags?.world?.fixture === "formation/trapbreak-wall"))?.walls.find((w) => w.flags?.world?.fixture === "formation/trapbreak-wall"))?.uuid ?? null`);
  if (!tbParty || !tbFighter || !tbWall) notWalked("C18a to C18c", "the formation/trapbreak-* fixtures are not in the world: run formation-trapbreak first, which builds them and brings them to their start shape");
  else {
    const tbf = await run(gm, P.formationOf, { partyId: tbParty });
    const ids = { fid: tbf.fid, actorId: tbFighter, targetUuid: tbWall };
    held.trapbreak = ids;
    await run(gm, P.begin, { fid: tbf.fid, kind: "swim" }).catch(() => null);
    await run(gm, P.end, { fid: tbf.fid });
    await run(player, P.tbOpen, ids);
    await run(gm, P.tbOpen, ids);
    const pw = await run(player, P.tbRead, ids);
    const gw = await run(gm, P.tbRead, ids);
    check("C18a the modifier field is drawn on the Player's seat with the \"Typed on this seat\" tooltip, and the Judge's seat has none", pw.field && pw.tip === "ACKS-FORMATION.doors.judgeModTyped" && gw.field && !gw.tip, { player: { field: pw.field, tip: pw.tip }, gm: { field: gw.field, tip: gw.tip } });
    check("C18a Mark found and Reset stay the Judge's: absent on the Player's seat, drawn on the Judge's", !pw.markFound && !pw.reset && gw.markFound !== undefined, { player: [pw.markFound, pw.reset], gm: [gw.markFound, gw.reset] });
    if (!pw.attemptEnabled) notWalked("C18b", "Work on it is not enabled on the Player's window (no thieves' tools, or no trap in reach): formation-trapbreak's Player steps give the start shape");
    else {
      await run(gm, P.rig, { face: 8 });
      held.rigged = true;
      const t0 = await run(gm, P.nowMs);
      await run(player, P.tbType, { ...ids, value: "0" });
      await run(player, P.tbAttempt, ids);
      const first = (await until(gm, P.cards, { since: t0 }, (x) => x.some((c) => c.formula), { tries: 20, every: 500 })).filter((c) => c.formula);
      const t1 = await run(gm, P.nowMs);
      await run(player, P.tbOpen, ids);
      await run(player, P.tbType, { ...ids, value: "3" });
      await run(player, P.tbAttempt, ids);
      const second = (await until(gm, P.cards, { since: t1 }, (x) => x.some((c) => c.formula), { tries: 20, every: 500 })).filter((c) => c.formula);
      for (const c of [...first, ...second]) cardIds.push(gm.track(c.id, "ChatMessage"));
      const bonusOf = (c) => (c ? Number(c.total) - Number(c.natural) : null);
      if (!first.length || !second.length) notWalked("C18b", `the second attempt posted no throw (first ${first.length}, second ${second.length}): a first made throw disarms the trap and the second is refused, so the two totals cannot be compared; re-shape the trap and run again`);
      else check("C18b the throw the Player's seat made with 3 typed carries 3 more than the one made with 0, the die held at the same face", first[0].natural === second[0].natural && bonusOf(second[0]) - bonusOf(first[0]) === 3, { naturals: [first[0].natural, second[0].natural], bonuses: [bonusOf(first[0]), bonusOf(second[0])] });
      await run(gm, P.rig, { face: null });
      held.rigged = false;
    }
    notWalked("C18c (a refusal that warns the Judge still blocks the Player)", "stands in formation-trapbreak's Player steps (the no-thieves'-tools window); this walk does not strip the fighter's tools");
    await run(player, P.tbClose, ids);
    await run(gm, P.tbClose, ids);
  }

  /* ------------------------------- W1: the wall sheet's trap row ------------------------------- */
  section("W1. The wall sheet's trap row");
  await run(gm, P.moveToken, { fid: fids.main, xy: { x: 300, y: 300 } });
  const wGm = await run(gm, P.wallRow, { wallUuid: wall.uuid });
  const wPl = await run(player, P.wallRow, { wallUuid: wall.uuid });
  check("W1 the Judge's wall sheet draws the trap row", wGm.can && wGm.row, wGm);
  if (wPl.can) check("W1 a seat Foundry lets write the wall is drawn the row", wPl.row, wPl);
  else {
    check("W1 a Player Foundry does not let write the wall is drawn no row", !wPl.row, wPl);
    notWalked("W1 (a Player gaining the row)", "no seat of this world holds the right to update walls: the test world's default permissions give it to Assistant and up, who are Judges here; the row's mount on `canTrapWall` is covered offline only");
  }

  /* ---------------------------- what the table saw ---------------------------- */
  section("what the table saw");
  await sleep(600);
  const aliases = [party.name, observed.party.name];
  for (const card of await run(gm, P.cards, { since })) {
    if (aliases.includes(card.alias)) cardIds.push(gm.track(card.id, "ChatMessage"));
  }
  note("cards tracked", cardIds.length);

  section("errors after ready");
  for (const [key, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${key}: nothing thrown over the walk`, !boot?.errors.length, boot?.errors);
  }
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  // The die, the crossing, the search session and the token are put back by what the run wrote; the fixtures stay.
  try { if (open.gm && held.rigged) await run(open.gm, P.rig, { face: null }); } catch (err) { console.error("rig:", err?.message ?? err); }
  for (const fid of held.fids) {
    try { if (open.gm) await run(open.gm, P.end, { fid }); } catch (err) { console.error("end:", err?.message ?? err); }
  }
  try { if (open.gm && held.sessionFid) await run(open.gm, P.endSession, { fid: held.sessionFid }); } catch (err) { console.error("session:", err?.message ?? err); }
  try { if (open.gm && held.fids[0] && held.tokenHome) await run(open.gm, P.moveToken, { fid: held.fids[0], xy: held.tokenHome }); } catch (err) { console.error("token:", err?.message ?? err); }
  try {
    if (open.gm && held.trapbreak) await run(open.gm, P.tbClose, held.trapbreak);
    if (open.player && held.trapbreak) await run(open.player, P.tbClose, held.trapbreak);
  } catch (_e) { /* closed */ }
  for (const partyId of held.partyIds) {
    try { if (open.player) await run(open.player, P.close, { partyId }); } catch (_e) { /* closed */ }
    try { if (open.gm) await run(open.gm, P.close, { partyId }); } catch (_e) { /* closed */ }
  }
  try {
    if (open.gm) {
      const only = cardIds.filter((u) => open.gm.tracked().some((e) => e.uuid === u));
      if (only.length) note("swept", await open.gm.sweepTracked({ only }));
    }
  } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed, ${tally.skipped} not walked`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
