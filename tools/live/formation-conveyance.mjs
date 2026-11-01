/**
 * Live walk: docs/formation/TESTING.md "Conveyance". A player pins foot through
 * the relay; a member joins by a drop on the sheet and is mounted; the Judge
 * presses Fastest for all, then Undo; the tiles set a word that holds the dawn
 * back, Back to automatic clears it; the clock crossing a dawn arranges the
 * party; a record from before the mode was derived reads; the relay refuses a
 * member and a carrier that are not the player's; and no load error lands on
 * either seat under a recorder added before reload.
 *
 * Every fixture and figure is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): the scene `conveyance/scene`; the party `conveyance/party`;
 * the characters `conveyance/rider`, `conveyance/mate` and `conveyance/late`, the
 * Player seat's, and `conveyance/hand`, nobody's; the animals `conveyance/pony`
 * and `conveyance/mule` and the wagon `conveyance/cart`, the Player seat's. The
 * walk brings them to its start shape itself: nobody on anything, no pin, no
 * word, `conveyance/late` out of the party. The carriers belong to the Player
 * seat for the run alone: between runs a peer walk's party on that seat would
 * take them at its own dawn.
 * Writes outside the ledger: the world clock, put back in the finally. A dawn
 * arranges every party on a journey, so `P.toDawn` puts any other party back by
 * its own Undo and reports which. The cards the relay posts are tracked by id
 * and swept in the finally.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { logDir, seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const SCOPE = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__cvBoot = { phase: "load", phases: [], errors: [] });
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
    active: game.users.filter((u) => u.active).map((u) => u.name),
    worldTime: game.time.worldTime,
    boot: globalThis.__cvBoot ?? null,
  }),

  install: async () => {
    const H = (globalThis.__cv = globalThis.__cv ?? {});
    const base = "/modules/acks-extras/scripts/";
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.travel = await import(`${base}formation/travel.mjs`);
    H.conveyance = await import(`${base}formation/conveyance.mjs`);
    H.requests = await import(`${base}formation/player-requests.mjs`);
    H.attachment = await import(`${base}lib/attachment.mjs`);
    H.mount = await import(`${base}lib/mount.mjs`);
    H.time = await import(`${base}lib/world-time.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    if (!H.notes) {
      H.notes = [];
      const info = ui.notifications.info;
      ui.notifications.info = function (msg, ...rest) {
        H.notes.push(String(msg));
        return info.call(this, msg, ...rest);
      };
    }
    return { ok: typeof H.conveyance.arrangeFastest === "function" };
  },

  /** Who may ride the walk's carriers: a level for the Player seat, 0 between runs. */
  carrierAccess: async ({ carriers, userId, level }) => {
    for (const id of carriers) await game.actors.get(id).update({ [`ownership.${userId}`]: level });
    return { [userId]: carriers.map((id) => game.actors.get(id).ownership[userId]) };
  },

  /** Nobody on anything, no pin, no word, nothing to undo, and only the listed members. */
  startShape: async ({ fid, members, others }) => {
    const H = globalThis.__cv;
    const formation = H.model.getFormation(fid);
    for (const id of [...members, ...others]) {
      const actor = game.actors.get(id);
      if (H.attachment.attachmentOf(actor)) await H.attachment.detach(actor);
      await actor.unsetFlag("acks-extras", H.conveyance.CONVEYANCE_FLAG);
    }
    for (const id of others) if (formation.members.some((m) => m?.actorId === id)) await H.model.removeMember(H.model.getFormation(fid), id);
    await H.model.patchFormation(fid, (rec) => {
      const cur = H.travel.storedTravelOf(rec);
      rec.travel = { ...cur, lastArrangement: null, movement: { ...cur.movement, set: null } };
    });
    await H.sleep(300);
    return { members: H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId) };
  },

  buildParty: async ({ partyId, sceneId, memberIds }) => {
    const H = globalThis.__cv;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    if (!found) return { error: "no formation for the party actor" };
    const fid = found.id;
    for (const id of memberIds) {
      if (!H.model.getFormation(fid).members.some((m) => m?.actorId === id)) await H.model.addMember(H.model.getFormation(fid), game.actors.get(id));
    }
    if (H.travel.travelOf(H.model.getFormation(fid)).mode !== "journey") await H.travel.setJourneyMode(fid, "journey", { sceneId });
    await H.sleep(300);
    return { fid, mode: H.travel.travelOf(H.model.getFormation(fid)).mode, members: H.model.getFormation(fid).members.length };
  },

  /** Open the sheet on a tab. A press finds its control fresh from the root each time. */
  open: async ({ partyId, tab = "mode" }) => {
    const H = globalThis.__cv;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    H.root(app)?.querySelector(`[data-action="tab"][data-tab="${tab}"]`)?.click();
    await H.sleep(300);
    return { rendered: !!H.root(app), editable: !!app.isEditable };
  },

  close: async ({ partyId }) => {
    const app = game.actors.get(partyId).sheet;
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** What the Movement section says on this seat. */
  movement: async ({ partyId }) => {
    const H = globalThis.__cv;
    const el = H.root(game.actors.get(partyId).sheet);
    const section = el?.querySelector('[data-section="movement"]');
    if (!section) return { section: false };
    const tiles = [...section.querySelectorAll('[data-action="movementTile"]')];
    return {
      section: true,
      lead: section.querySelector(".acks-extras-movement-pace-lead")?.textContent ?? null,
      sub: section.querySelector(".acks-extras-movement-pace-sub")?.textContent ?? null,
      figure: section.querySelector(".acks-extras-movement-pace-figure")?.textContent ?? null,
      figureTip: section.querySelector(".acks-extras-movement-pace-figure")?.dataset.tooltipText ?? null,
      faster: section.querySelector(".acks-extras-movement-pace .acks-extras-party-sheet__chip")?.textContent ?? null,
      tiles: tiles.length,
      lit: tiles.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.mode),
      disabled: tiles.filter((b) => b.disabled).length,
      state: [...section.querySelectorAll(".acks-extras-movement-state .acks-extras-party-sheet__chip")].map((c) => c.textContent),
      back: !!section.querySelector('[data-action="movementFastest"]'),
      undo: !!section.querySelector('[data-action="movementUndo"]'),
      flight: !!section.querySelector('input[name="travel.movement.hoursAloft"]'),
    };
  },

  /** Press a control on the open sheet, as a click. */
  press: async ({ partyId, selector, settle = 1500 }) => {
    const H = globalThis.__cv;
    const el = H.root(game.actors.get(partyId).sheet);
    const control = el?.querySelector(selector);
    if (!control) return { found: false, selector };
    const disabled = !!control.disabled;
    control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },

  /** One member's row on the Order tab. */
  row: async ({ partyId, actorId }) => {
    const H = globalThis.__cv;
    const el = H.root(game.actors.get(partyId).sheet);
    const row = el?.querySelector(`li.member[data-actor-id="${actorId}"] .acks-extras-formation-conveyance`);
    if (!row) return { row: false };
    const buttons = [...row.querySelectorAll('[data-action="conveyancePick"]')];
    return {
      row: true,
      how: row.querySelector(".acks-extras-formation-conveyance-how")?.textContent ?? null,
      picks: buttons.map((b) => ({ pick: b.dataset.pick, pressed: b.getAttribute("aria-pressed") === "true", disabled: b.disabled, tip: b.dataset.tooltipText ?? null })),
    };
  },

  /** Who is on what, each pin, the word, and the party actor's own speed, read on this seat. */
  state: async ({ fid, partyId, ids }) => {
    const H = globalThis.__cv;
    const t = H.travel.travelOf(H.model.getFormation(fid));
    const seats = Object.fromEntries(ids.map((id) => {
      const actor = game.actors.get(id);
      const at = H.attachment.attachmentOf(actor);
      return [id, { on: at?.uuid ?? null, role: at?.role ?? null, pin: H.conveyance.pinOf(actor) }];
    }));
    return {
      seats,
      set: t.movement.set,
      mode: t.movement.mode,
      undoable: !!t.lastArrangement,
      speed: H.model.partySpeed(H.model.getFormation(fid), { dark: false }),
      actorSpeed: game.actors.get(partyId).system?.movement?.base ?? null,
      storedMode: Object.hasOwn(H.travel.storedTravelOf(H.model.getFormation(fid)).movement, "mode"),
    };
  },

  /** Take a member off whatever carries them, past the arrangement, as a sheet would. */
  toFoot: async ({ actorId }) => {
    const H = globalThis.__cv;
    const actor = game.actors.get(actorId);
    await H.mount.dismount(actor);
    if (H.attachment.attachmentOf(actor)) await H.attachment.detach(actor);
    await H.sleep(200);
    return { on: H.attachment.attachmentOf(actor)?.uuid ?? null };
  },

  /** A drop on the open sheet's root, the way a member joins. */
  drop: async ({ partyId, actorId, fid }) => {
    const H = globalThis.__cv;
    const el = H.root(game.actors.get(partyId).sheet);
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(actorId).uuid }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    const joined = await H.poll(() => H.model.getFormation(fid).members.some((m) => m?.actorId === actorId));
    return { joined: !!joined };
  },

  takeNotes: async () => globalThis.__cv.notes.splice(0),

  /**
   * The clock to just past the next dawn. A dawn arranges every party on a
   * journey, a peer walk's kept one among them, so whatever it moved beyond
   * this run's party goes back by that party's own Undo, in the same step.
   * The pass follows the day's settling of every party, so its length grows with
   * the world: `moves` waits for this party's record to change, and either way
   * the step ends on a quiet stretch with no party's record changing.
   */
  toDawn: async ({ fid, moves = false }) => {
    const H = globalThis.__cv;
    const parties = () => Object.values(H.model.getFormations());
    const others = () => parties().filter((f) => f.id !== fid);
    const lastOf = (f) => JSON.stringify(H.travel.travelOf(f).lastArrangement ?? null);
    const stamp = () => parties().map(lastOf).join();
    const before = new Map(parties().map((f) => [f.id, lastOf(f)]));
    const step = H.time.untilNextDawn();
    await game.time.advance(step);
    const started = Date.now();
    let seen = stamp();
    let quietSince = started;
    while (Date.now() - started < 30000) {
      await H.sleep(500);
      if (stamp() !== seen) { seen = stamp(); quietSince = Date.now(); }
      const own = before.get(fid) !== lastOf(H.model.getFormation(fid));
      if ((moves ? own : Date.now() - started >= 8000) && Date.now() - quietSince >= 3000) break;
    }
    const putBack = [];
    for (const f of others()) {
      if (before.get(f.id) === lastOf(f)) continue;
      putBack.push({ party: f.id, moved: await H.conveyance.undoArrangement(f.id) });
    }
    return { step, dark: H.time.clockReading()?.dark ?? null, putBack };
  },

  setClock: async ({ worldTime }) => {
    await game.time.set(worldTime);
    return { worldTime: game.time.worldTime };
  },

  /** Write the stored movement as a record from before the mode was derived held it. */
  legacy: async ({ fid, movement }) => {
    const H = globalThis.__cv;
    await H.model.patchFormation(fid, (rec) => {
      const { set: _set, ...rest } = rec.travel.movement ?? {};
      rec.travel = { ...rec.travel, movement: { ...rest, ...movement } };
    });
    await H.sleep(400);
    const t = H.travel.travelOf(H.model.getFormation(fid));
    return { set: t.movement.set, mode: t.movement.mode };
  },

  /** A relayed request as a player's client sends it, past the sheet's own checks. */
  relay: async ({ fid, payload }) => {
    const H = globalThis.__cv;
    await H.requests.requestPartyAction(fid, "conveyance", payload);
    await H.sleep(1500);
    return { sent: true };
  },

  /** Size the sheet and bring a control to the top of its scroller, for a plate and a clipping read. */
  frame: async ({ partyId, width, selector }) => {
    const H = globalThis.__cv;
    const app = game.actors.get(partyId).sheet;
    app.setPosition({ width, height: Math.min(window.innerHeight - 40, 860) });
    await H.sleep(400);
    const el = H.root(app)?.querySelector(selector);
    el?.scrollIntoView({ block: "start" });
    await H.sleep(250);
    const box = el?.getBoundingClientRect();
    const clipped = [...(el?.querySelectorAll("button, .acks-extras-movement-pace-figure") ?? [])]
      .filter((node) => node.scrollWidth > node.clientWidth + 1 || node.getBoundingClientRect().right > box.right + 1)
      .map((node) => node.textContent.trim());
    return { width: app.position.width, height: app.position.height, overflow: !!el && el.scrollWidth > el.clientWidth + 1, clipped };
  },

  /** The cards this seat can read that name the run's party in a declaration. */
  cards: async ({ since, words }) => game.messages.contents
    .filter((m) => m.timestamp >= since && words.every((w) => (m.content ?? "").includes(w)))
    .map((m) => m.id),

  boot: async () => globalThis.__cvBoot ?? null,
  nowMs: async () => Date.now(),
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

const open = {};
const cards = [];
const access = { carriers: [], userId: null };
let worldTime0 = null;

const character = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
const animal = (name, run_) => ({
  name,
  type: `${SCOPE}.animal`,
  system: { animal: { mountable: true } },
  flags: { [SCOPE]: { extras: { speeds: [{ type: "land", run: run_ }] } } },
});
const wagon = (name, capacity, feet) => ({
  name,
  type: `${SCOPE}.vehicle`,
  system: {
    kind: "land",
    cargo: { capacityStone: capacity },
    speeds: { tiers: [{ team: 1, maxLoadStone: capacity, feetPerTurn: feet }] },
    team: { animals: [{ kind: "heavyHorse", count: 1 }] },
  },
});

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  note("installed", [await run(gm, P.install), await run(player, P.install)]);
  const census = { gm: await run(gm, P.census), player: await run(player, P.census) };
  note("active", census.gm.active);
  check("the GM seat is the active GM, and the player seat is a player", census.gm.activeGMIsSelf && census.player.role <= 2, { gm: census.gm.role, player: census.player.role });
  if (!census.gm.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  worldTime0 = census.gm.worldTime;
  for (const [key, c] of Object.entries(census)) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }

  section("fixtures");
  const yours = { default: 0, [census.player.userId]: 3 };
  const scene = await gm.fixture("conveyance/scene", "Scene", { name: "Conveyance Walk", width: 1200, height: 800, grid: { size: 100 } });
  const party = await gm.fixture("conveyance/party", "Actor", { name: "QA Conveyance Party", type: `${SCOPE}.party` });
  const rider = await gm.fixture("conveyance/rider", "Actor", { ...character("QA Rider"), ownership: yours });
  const mate = await gm.fixture("conveyance/mate", "Actor", { ...character("QA Mate"), ownership: yours });
  const hand = await gm.fixture("conveyance/hand", "Actor", character("QA Hand"));
  const late = await gm.fixture("conveyance/late", "Actor", { ...character("QA Late"), ownership: yours });
  const pony = await gm.fixture("conveyance/pony", "Actor", { ...animal("QA Pony", 240), ownership: yours });
  const mule = await gm.fixture("conveyance/mule", "Actor", { ...animal("QA Mule", 180), ownership: yours });
  const cart = await gm.fixture("conveyance/cart", "Actor", { ...wagon("QA Cart", 600, 150), ownership: yours });
  access.carriers = [pony.id, mule.id, cart.id];
  access.userId = census.player.userId;
  note("the carriers go to the Player seat for the run", await run(gm, P.carrierAccess, { ...access, level: 3 }));
  const members = [rider.id, mate.id, hand.id];
  const ids = [...members, late.id];
  const built = await run(gm, P.buildParty, { partyId: party.id, sceneId: scene.id, memberIds: members });
  if (built.error) throw new Error(built.error);
  const fid = built.fid;
  note("start shape", await run(gm, P.startShape, { fid, members, others: [late.id] }));
  const read = (seat = gm) => run(seat, P.state, { fid, partyId: party.id, ids });
  const uuid = (doc) => `Actor.${doc.id}`;
  const since = await run(gm, P.nowMs);

  section("every seat reads the pace; only the Judge's presses");
  note("GM sheet", await run(gm, P.open, { partyId: party.id }));
  note("player sheet", await run(player, P.open, { partyId: party.id }));
  await sleep(1000);
  const gmMove = await run(gm, P.movement, { partyId: party.id });
  const plMove = await run(player, P.movement, { partyId: party.id });
  note("GM", gmMove);
  note("player", plMove);
  check("the five tiles reach both seats", gmMove.tiles === 5 && plMove.tiles === 5, { gm: gmMove.tiles, player: plMove.tiles });
  check("only the Judge's are live", gmMove.disabled === 0 && plMove.disabled === 5, { gm: gmMove.disabled, player: plMove.disabled });
  check("a party on foot lights the foot tile, automatically, on both seats", gmMove.lit[0] === "foot" && plMove.lit[0] === "foot" && gmMove.state.length === 1 && plMove.state.length === 1, { gm: gmMove.lit, player: plMove.lit });
  check("the pace line names who sets it, and the figure carries where it came from", /QA /.test(gmMove.lead) && !!gmMove.figureTip && gmMove.figureTip.includes("QA Rider"), { lead: gmMove.lead, tip: gmMove.figureTip });
  check("the chip offers the faster ride", !!gmMove.faster, gmMove.faster);
  check("a seat that owns only some of the party reads the Judge's pace, its setter and its parts", plMove.lead === gmMove.lead && plMove.figure === gmMove.figure && plMove.figureTip === gmMove.figureTip, { gm: [gmMove.lead, gmMove.figure, gmMove.figureTip], player: [plMove.lead, plMove.figure, plMove.figureTip] });

  section("a player pins foot");
  note("player to the Order tab", await run(player, P.open, { partyId: party.id, tab: "order" }));
  const before = await run(player, P.row, { partyId: party.id, actorId: rider.id });
  note("the row", before);
  check("a player's own member offers Automatic, On foot and the carriers they own", before.picks?.length >= 5 && before.picks.every((p) => !p.disabled) && before.picks[0].pressed, before.picks?.map((p) => p.pick));
  const handRow = await run(player, P.row, { partyId: party.id, actorId: hand.id });
  check("a member the player does not own reads, with no picks", handRow.row && !handRow.picks.length, handRow);
  note("press", await run(player, P.press, { partyId: party.id, selector: `li.member[data-actor-id="${rider.id}"] [data-pick="foot"]`, settle: 2500 }));
  let s = await read();
  check("the pin lands on the actor through the relay, and nobody moved", s.seats[rider.id].pin === "foot" && !s.seats[rider.id].on, s.seats[rider.id]);
  for (const id of await run(gm, P.cards, { since, words: ["QA Rider"] })) cards.push(gm.track(id, "ChatMessage"));
  check("the table is told", cards.length >= 1, cards.length);
  const pinned = await run(player, P.row, { partyId: party.id, actorId: rider.id });
  check("the row redraws on the player's own seat with the pin pressed", pinned.picks?.find((p) => p.pick === "foot")?.pressed === true, pinned.picks?.map((p) => [p.pick, p.pressed]));

  section("a member joins and is mounted");
  note("GM to the Order tab", await run(gm, P.open, { partyId: party.id, tab: "order" }));
  note("drop", await run(gm, P.drop, { partyId: party.id, actorId: late.id, fid }));
  await sleep(1500);
  s = await read();
  check("the one who joined takes the fastest they have", s.seats[late.id].on === uuid(pony) && s.seats[late.id].role === "rider", s.seats[late.id]);
  check("nobody else moved, and the pin held", !s.seats[rider.id].on && !s.seats[mate.id].on && !s.seats[hand.id].on, s.seats);
  const toast = await run(gm, P.takeNotes);
  check("the Judge is told who moved", toast.some((n) => n.includes("QA Late")), toast);

  section("Fastest for all, then Undo");
  const speed0 = s.speed;
  note("press", await run(gm, P.press, { partyId: party.id, selector: '[data-part="order"] [data-action="movementFastest"], [data-action="movementFastest"]', settle: 2500 }));
  s = await read();
  note("seats", s.seats);
  check("the pin holds against Fastest for all", !s.seats[rider.id].on, s.seats[rider.id]);
  check("the rider keeps their horse", s.seats[late.id].on === uuid(pony), s.seats[late.id]);
  check("the next takes the mule, faster than the cart", s.seats[mate.id].on === uuid(mule), s.seats[mate.id]);
  check("nothing is under the unowned hand", !s.seats[hand.id].on, s.seats[hand.id]);
  check("the arrangement can be undone", s.undoable === true, s.undoable);
  check("the sheet reads the same speed the actor carries", s.actorSpeed === s.speed, { actor: s.actorSpeed, speed: s.speed });
  const plAfter = await read(player);
  check("the player's seat reads the same seats", JSON.stringify(plAfter.seats) === JSON.stringify(s.seats), plAfter.seats);
  note("Undo", await run(gm, P.press, { partyId: party.id, selector: '[data-action="movementUndo"]', settle: 2500 }));
  s = await read();
  check("Undo takes the mule back and leaves what the pass did not move", !s.seats[mate.id].on && s.seats[late.id].on === uuid(pony), s.seats);
  check("it spends itself and the speed returns", !s.undoable && s.speed === speed0 && s.actorSpeed === speed0, { undoable: s.undoable, speed: s.speed, actor: s.actorSpeed });

  section("a wagon in the train counts for one with no player");
  await run(gm, P.press, { partyId: party.id, selector: `li.member[data-actor-id="${mate.id}"] [data-pick="${uuid(cart)}"]`, settle: 2000 });
  s = await read();
  check("a member's own press boards the wagon", s.seats[mate.id].on === uuid(cart) && s.seats[mate.id].pin === uuid(cart), s.seats[mate.id]);
  const handNow = await run(gm, P.row, { partyId: party.id, actorId: hand.id });
  check("the unowned hand now has it to pick", handNow.picks?.some((p) => p.pick === uuid(cart)), handNow.picks?.map((p) => p.pick));
  check("the mode reads the wagon, and the record stores no mode", s.mode === "vehicle" && !s.storedMode, { mode: s.mode, stored: s.storedMode });

  section("the tiles are the Judge's word");
  note("GM to the Wilderness tab", await run(gm, P.open, { partyId: party.id }));
  await run(gm, P.press, { partyId: party.id, selector: '[data-action="movementTile"][data-mode="foot"]', settle: 2500 });
  s = await read();
  const worded = await run(gm, P.movement, { partyId: party.id });
  note("after the On foot tile", { seats: s.seats, worded });
  check("On foot takes everyone off, over a pin that survives", ids.every((id) => !s.seats[id].on) && s.seats[mate.id].pin === uuid(cart), s.seats);
  check("the word is set, shown, and offers the way back and the Undo", s.set === "foot" && worded.back && worded.undo && worded.lit[0] === "foot", { set: s.set, state: worded.state });
  note("the clock to a dawn under the word", await run(gm, P.toDawn, { fid }));
  s = await read();
  check("a dawn leaves the word alone", ids.every((id) => !s.seats[id].on), s.seats);
  await run(gm, P.press, { partyId: party.id, selector: '[data-action="movementTile"][data-mode="vessel"]', settle: 1500 });
  const vessel = await run(gm, P.movement, { partyId: party.id });
  s = await read();
  check("a tile with nothing to board stands as the word and lights", s.set === "vessel" && vessel.lit[0] === "vessel" && s.mode === "vessel", { set: s.set, lit: vessel.lit });
  await run(gm, P.press, { partyId: party.id, selector: '[data-action="movementTile"][data-mode="flying"]', settle: 1500 });
  const flying = await run(gm, P.movement, { partyId: party.id });
  check("Flying shows the hours to declare, on the Judge's seat", flying.flight === true && flying.lit[0] === "flying", flying);
  await run(gm, P.press, { partyId: party.id, selector: '[data-section="movement"] [data-action="movementFastest"]', settle: 2500 });
  s = await read();
  check("Back to automatic clears the word and arranges, a pin going to its carrier", s.set === null && s.seats[mate.id].on === uuid(cart) && !!s.seats[late.id].on, s.seats);

  section("the dawn arranges the party");
  const afoot = await run(gm, P.toFoot, { actorId: late.id });
  check("the member starts the dawn on foot, by hand", !afoot.on, afoot);
  await run(gm, P.takeNotes);
  note("the clock to the dawn", await run(gm, P.toDawn, { fid, moves: true }));
  s = await read();
  // Parties go in the record's order, and a peer's on this seat may take the pony first.
  check("the clock crossing a dawn seats them", !!s.seats[late.id].on, s.seats[late.id]);
  const dawnToast = await run(gm, P.takeNotes);
  check("and the Judge is told", dawnToast.some((n) => n.includes("QA Late")), dawnToast);

  section("the relay refuses what is not the player's");
  const beforeRefuse = await read();
  await run(player, P.relay, { fid, payload: { actorId: hand.id, pick: "foot" } });
  await run(player, P.relay, { fid, payload: { actorId: rider.id, pick: uuid(hand) } });
  s = await read();
  check("a member they do not own, and a carrier off their offers, change nothing", JSON.stringify(s.seats) === JSON.stringify(beforeRefuse.seats), s.seats);

  section("a record from before");
  note("old mounted word", await run(gm, P.legacy, { fid, movement: { mode: "mounted" } }));
  s = await read();
  check("an old derived word says nothing, and the party reads what carries it", s.set === null && s.mode !== "flying", { set: s.set, mode: s.mode });
  note("old flying word", await run(gm, P.legacy, { fid, movement: { mode: "flying" } }));
  s = await read();
  check("an old declared word reads as the word", s.set === "flying" && s.mode === "flying", { set: s.set, mode: s.mode });
  await run(gm, P.press, { partyId: party.id, selector: '[data-section="movement"] [data-action="movementFastest"]', settle: 2500 });
  s = await read();
  check("Back to automatic moves it onto the new shape", s.set === null && !s.storedMode, { set: s.set, stored: s.storedMode });

  section("plates");
  await gm.compose?.(`#${(await gm.eval(`game.actors.get(${JSON.stringify(party.id)}).sheet.id`))}`);
  await run(gm, P.open, { partyId: party.id });
  const movementControl = '[data-section="movement"]';
  const memberRow = `li.member[data-actor-id="${mate.id}"]`;
  try {
    const wide = await run(gm, P.frame, { partyId: party.id, width: 920, selector: movementControl });
    await gm.shot(path.join(logDir(), "conveyance-movement.png"), movementControl);
    const narrow = await run(gm, P.frame, { partyId: party.id, width: 560, selector: movementControl });
    await gm.shot(path.join(logDir(), "conveyance-movement-narrow.png"), movementControl);
    check("the Movement section fits its sheet, wide and narrow, with nothing clipped", !wide.overflow && !narrow.overflow && !wide.clipped.length && !narrow.clipped.length, { wide, narrow });
    await run(gm, P.open, { partyId: party.id, tab: "order" });
    await run(gm, P.frame, { partyId: party.id, width: 920, selector: memberRow });
    await gm.shot(path.join(logDir(), "conveyance-order.png"), memberRow);
    const narrowRow = await run(gm, P.frame, { partyId: party.id, width: 560, selector: memberRow });
    await gm.shot(path.join(logDir(), "conveyance-order-narrow.png"), memberRow);
    check("a member's picks wrap in a narrow sheet", !narrowRow.overflow, narrowRow);
    note("plates", "written to the log directory");
  } catch (err) { console.log(`plates not taken: ${err?.message ?? err}`); }

  section("errors after ready");
  for (const [key, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${key} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors);
  }
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (open.gm && worldTime0 != null) note("clock put back", await run(open.gm, P.setClock, { worldTime: worldTime0 })); } catch (err) { console.error("clock:", err?.message ?? err); }
  try { if (open.gm && access.userId) note("the carriers out of a Player seat's reach between runs", await run(open.gm, P.carrierAccess, { ...access, level: 0 })); } catch (err) { console.error("carriers:", err?.message ?? err); }
  try { if (open.gm && cards.length) note("cards swept", await open.gm.sweepTracked({ only: cards })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
