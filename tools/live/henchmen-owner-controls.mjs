/**
 * Live walk, henchmen-owner-controls: the roster's row controls and the
 * compensated toggle follow the hireling's owner, and the secret loyalty throw
 * stays on a GM's seat. Walks docs/henchmen/TESTING.md "Owner controls from a
 * Player seat" on the GM and Player seats. Machine values arrive through
 * ./_env.mjs.
 *
 * Step "toggle": the Player's Service tab and Roster row draw the compensated
 * toggle on a hireling the Player owns; pressing it compensates the entry,
 * moves the loyalty figure by the entry's delta and logs an `adjustment`;
 * pressing it in the Roster restores it. A hireling under the Player's
 * employer that the Player does not own draws the read-only tick and no
 * toggle.
 *
 * Step "roster": the henchman row draws Calamity, Penalty, Transfer and
 * Dismiss and no loyalty or obedience dice; the mercenary row draws Morale,
 * Transfer and Dismiss; the foreign row draws none of the four. Calamity is
 * recorded with `autoRollCalamity` held each way (the world's value is read,
 * reported and restored): the counter and a `calamity` event land, no
 * loyalty-throw window opens on the Player seat, the GM seat receives the
 * calamity card, and the Player pressing the card's throw and waive buttons
 * opens and logs nothing. Transfer lists the Player's other character and no
 * character the Player does not own, and moves the hireling and its record.
 * Dismiss, last, takes its own fixture off the roster.
 *
 * Fixtures, kept and found by marker (every one a character):
 * `henchmen/owner-employer` and `henchmen/owner-employer-2` (the Player owns
 * both; the second is out of service and is the transfer target),
 * `henchmen/foreign-employer` (not the Player's, out of service),
 * `henchmen/owner-hireling` (a henchman of the first, owned by the Player),
 * `henchmen/owner-merc` (a mercenary of the first, owned by the Player),
 * `henchmen/owner-foreign-hireling` (a henchman of the first with the Player's
 * ownership withdrawn) and `henchmen/owner-dismiss` (the hireling Dismiss acts
 * on, re-enrolled at that step's start). Each step re-asserts the shape it
 * needs. The chat cards the run's calamities and transfers post speak as a
 * fixture; the GM seat lists them by id as they arrive and sweeps those ids
 * alone. The loyalty-figure check assumes the entry's delta does not hit the
 * score's upper bound. Every figure printed is a count or a boolean.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKERS = {
  employer: "henchmen/owner-employer",
  employer2: "henchmen/owner-employer-2",
  foreignEmployer: "henchmen/foreign-employer",
  hireling: "henchmen/owner-hireling",
  merc: "henchmen/owner-merc",
  foreignHireling: "henchmen/owner-foreign-hireling",
  dismiss: "henchmen/owner-dismiss",
};
/** The ledger entry's marker note, so the walk finds its own entry among a record's. */
const ENTRY_NOTE = "owner-controls";
/** The entry's delta: a penalty, so compensating it raises the score by one. */
const ENTRY_DELTA = -1;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__oc = globalThis.__oc ?? {});
    const M = "/modules/acks-extras/scripts/henchmen";
    H.HI = await import(`${M}/engine/hire.mjs`);
    H.EV = await import(`${M}/engine/events.mjs`);
    H.AD = await import(`${M}/acks-adapter.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : (app?.element?.[0] ?? null));
    H.apps = () => [...foundry.applications.instances.values()];
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      // Every application this seat renders, by class name, and every chat
      // message this seat receives, whoever made it.
      H.rendered = [];
      H.msgs = [];
      H.hookIds = [
        ["renderApplicationV2", Hooks.on("renderApplicationV2", (app) => H.rendered.push(app.constructor?.name ?? ""))],
        ["createChatMessage", Hooks.on("createChatMessage", (m) => H.msgs.push({ id: m.id, uuid: m.uuid, actor: m.speaker?.actor ?? null, loyaltyButton: /rollLoyaltySecret/.test(m.content ?? ""), whispered: (m.whisper ?? []).length > 0 }))],
      ];
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  userId: async ({ name }) => game.users.getName(name)?.id ?? null,
  setting: async ({ key, value }) => {
    const before = game.settings.get("acks-extras", key);
    if (value !== undefined && value !== before) await game.settings.set("acks-extras", key, value);
    return { before, now: game.settings.get("acks-extras", key) };
  },
  readSetting: async ({ key }) => game.settings.get("acks-extras", key),
  /**
   * GM seat. Put each named fixture in the shape the steps need: the employers'
   * ownership and service state, then each hireling in `serve` under the first
   * employer with the right category and the Player's ownership as the recipe
   * lists it. Booleans only.
   */
  shape: async ({ ids, playerId, serve }) => {
    const H = globalThis.__oc;
    const OWN = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const doc = (k) => game.actors.get(ids[k]);
    const player = game.users.get(playerId);
    const setOwn = async (a, level) => { if ((a.ownership?.[playerId] ?? OWN.NONE) !== level) await a.update({ [`ownership.${playerId}`]: level }); };
    const out = {};
    for (const k of ["employer", "employer2", "foreignEmployer"]) {
      const a = doc(k);
      if (a.system.retainer?.enabled && k !== "employer") await H.AD.setRetainer(a, { enabled: false, managerid: "" });
      if (!a.prototypeToken.actorLink) await a.update({ "prototypeToken.actorLink": true });
      await setOwn(a, k === "foreignEmployer" ? OWN.NONE : OWN.OWNER);
    }
    const employer = doc("employer");
    const serveOne = async (k, category) => {
      const a = doc(k);
      // Core's roster refuses a character another employer already lists, and
      // its removal clears the manager and leaves the retainer switch on.
      for (const x of game.actors.filter((x) => x.id !== employer.id && (x.system.henchmenList ?? []).includes(a.id))) await H.AD.delHenchman(x, a.id);
      if (!a.system.retainer?.enabled) await H.HI.enrollHenchman(employer, a, { loyalty: 2 });
      else if (!(employer.system.henchmenList ?? []).includes(a.id)) await H.AD.addHenchman(employer, a.id);
      if (a.system.retainer?.managerid !== employer.id) await H.AD.setRetainer(a, { managerid: employer.id });
      const record = a.getFlag("acks-extras", "record") ?? {};
      if (record.employerUuid !== employer.uuid) await a.setFlag("acks-extras", "record", { ...record, employerUuid: employer.uuid });
      if (category && a.system.retainer?.category !== category) await H.AD.setRetainer(a, { category });
      await setOwn(a, k === "foreignHireling" ? OWN.NONE : OWN.OWNER);
    };
    for (const k of serve) await serveOne(k, k === "merc" ? "mercenary" : "henchman");
    for (const k of serve) {
      const a = doc(k);
      out[k] = {
        serves: a.system.retainer?.enabled === true && a.system.retainer?.managerid === employer.id && (employer.system.henchmenList ?? []).includes(a.id),
        playerOwns: a.testUserPermission(player, "OWNER"),
        category: a.system.retainer?.category,
      };
    }
    out.employerOwned = doc("employer").testUserPermission(player, "OWNER");
    out.employer2Owned = doc("employer2").testUserPermission(player, "OWNER");
    out.employer2Idle = !doc("employer2").system.retainer?.enabled;
    out.foreignEmployerNotOwned = !doc("foreignEmployer").testUserPermission(player, "OWNER");
    out.foreignEmployerIdle = !doc("foreignEmployer").system.retainer?.enabled;
    return out;
  },
  /**
   * GM seat. Rewrite a record's loyalty ledger to the entries given and sync
   * the score. The walk's own kept fixtures carry whatever the last run left.
   */
  setLedger: async ({ actorId, entries }) => {
    const H = globalThis.__oc;
    const a = game.actors.get(actorId);
    const record = a.getFlag("acks-extras", "record") ?? {};
    const permanents = entries.map((e) => ({ time: Math.floor(game.time.worldTime), delta: e.delta, reason: "wound", note: e.note, compensated: !!e.compensated }));
    // The event log is emptied too: it is capped, and a kept fixture's earlier runs
    // would make a count of new events or a search for one pass on their leavings.
    await a.setFlag("acks-extras", "record", { ...record, events: [], loyalty: { ...(record.loyalty ?? { start: null }), permanents } });
    await H.EV.syncLoyalty(a);
    const back = a.getFlag("acks-extras", "record")?.loyalty?.permanents ?? [];
    return { entries: back.length, compensated: back.filter((p) => p.compensated).length, scoreRead: H.EV.effectiveLoyaltyFor(a) !== null };
  },
  /** GM seat: empty a record's capped event log, so a search for one event reads this run's. */
  resetEvents: async ({ actorId }) => {
    const a = game.actors.get(actorId);
    const record = a.getFlag("acks-extras", "record") ?? {};
    await a.setFlag("acks-extras", "record", { ...record, events: [] });
    return (a.getFlag("acks-extras", "record")?.events ?? []).length === 0;
  },
  /** What a hireling's record and actor say now. */
  read: async ({ actorId }) => {
    const H = globalThis.__oc;
    const a = game.actors.get(actorId);
    const r = a.getFlag("acks-extras", "record") ?? {};
    const own = (r.loyalty?.permanents ?? []).findIndex((p) => p.note === "owner-controls");
    return {
      entries: (r.loyalty?.permanents ?? []).map((p) => ({ delta: p.delta, reason: p.reason, compensated: !!p.compensated })),
      own,
      ownCompensated: own >= 0 ? !!r.loyalty.permanents[own].compensated : null,
      score: H.EV.effectiveLoyaltyFor(a),
      events: (r.events ?? []).map((e) => e.type),
      calamities: r.counters?.calamities ?? 0,
      employerUuid: r.employerUuid ?? "",
      managerid: a.system.retainer?.managerid ?? "",
      enabled: a.system.retainer?.enabled === true,
      listedBy: game.actors.filter((x) => (x.system.henchmenList ?? []).includes(a.id)).map((x) => x.id),
    };
  },
  /** A mark in this seat's render log, and the throw windows open now closed. */
  markRender: async () => {
    const H = globalThis.__oc;
    for (const app of H.apps()) if (["ThrowDialog", "InfluenceApp"].includes(app.constructor?.name)) await app.close({ force: true });
    H.mark = H.rendered.length;
    return H.mark;
  },
  /** The loyalty-throw windows this seat rendered or holds open since `markRender`. */
  throwWindows: async () => {
    const H = globalThis.__oc;
    const names = ["ThrowDialog", "InfluenceApp"];
    return {
      rendered: H.rendered.slice(H.mark ?? 0).filter((n) => names.includes(n)).length,
      open: H.apps().filter((a) => names.includes(a.constructor?.name)).length,
    };
  },
  /** GM seat: the chat cards received since the install that speak as one of `actorIds`, by uuid, and whether one carries the loyalty throw button. */
  cards: async ({ actorIds, actorId }) => {
    const H = globalThis.__oc;
    const mine = H.msgs.filter((m) => actorIds.includes(m.actor));
    const named = actorId ? mine.filter((m) => m.actor === actorId && m.loyaltyButton && game.messages.get(m.id)?.visible) : [];
    return { uuids: mine.map((m) => m.uuid), calamityCards: named.map((m) => m.id), count: mine.length };
  },
  /** Player seat: the card's id for `actorId` that carries the loyalty button, newest first, as this seat received it. */
  seenCard: async ({ actorId }) => {
    const H = globalThis.__oc;
    const found = await H.poll(() => [...H.msgs].reverse().find((m) => m.actor === actorId && m.loyaltyButton) ?? null, { tries: 24, every: 250 });
    return found ? { id: found.id, whispered: found.whispered } : null;
  },
  /** Player seat: press `action` on the card's button where the chat log draws it. */
  pressCard: async ({ messageId, action }) => {
    const H = globalThis.__oc;
    try { ui.sidebar?.expand?.(); ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* the log may already be showing */ }
    const button = await H.poll(() => document.querySelector(`.chat-message[data-message-id="${messageId}"] [data-acks-extras-action="${action}"]`), { tries: 24, every: 250 });
    if (!button) return { found: false };
    button.click();
    await H.sleep(2500);
    return { found: true };
  },
  /**
   * This seat opens the hireling's sheet on its Service tab and reads whether
   * the ledger toggle is drawn there; `press` clicks the first one and waits
   * for the record to change.
   */
  serviceToggle: async ({ actorId, press }) => {
    const H = globalThis.__oc;
    const a = game.actors.get(actorId);
    const before = JSON.stringify((a.getFlag("acks-extras", "record") ?? {}).loyalty?.permanents ?? []);
    await a.sheet.render(true);
    await H.poll(() => H.root(a.sheet)?.isConnected);
    try { a.sheet.changeTab("service", "primary"); } catch { /* a sheet with no Service tab */ }
    await H.sleep(600);
    const service = H.root(a.sheet)?.querySelector(".acks-extras-service");
    const button = service?.querySelector('[data-action="toggleCompensated"]') ?? null;
    const out = { rendered: !!service, drawn: !!button, named: !!button?.dataset.tooltip && !/ACKS-HENCHMEN\./.test(button.dataset.tooltip), changed: false };
    if (press && button) {
      button.click();
      out.changed = !!(await H.poll(() => JSON.stringify((a.getFlag("acks-extras", "record") ?? {}).loyalty?.permanents ?? []) !== before, { tries: 24, every: 250 }));
    }
    await a.sheet.close();
    return out;
  },
  /** Open the employer's Roster window on this seat; the app is kept for the presses that follow. */
  rosterOpen: async ({ employerId }) => {
    const H = globalThis.__oc;
    if (H.roster) await H.roster.close();
    acksExtras.henchmen.openRosterApp(game.actors.get(employerId));
    H.roster = await H.poll(() => {
      const x = H.apps().find((a) => a.constructor?.name === "RosterApp" && a.employer?.id === employerId);
      return x && H.root(x)?.querySelector(".acks-extras-roster__row") ? x : null;
    }, { tries: 40, every: 250 });
    return { opened: !!H.roster };
  },
  /** The roster's controls per row: the `data-action` names each row draws in its control strip. */
  rosterControls: async () => {
    const H = globalThis.__oc;
    const rows = [...(H.root(H.roster)?.querySelectorAll(".acks-extras-roster__row") ?? [])];
    return Object.fromEntries(rows.map((r) => [r.dataset.actorId, [...r.querySelectorAll(".acks-extras-frame__ctls [data-action]")].map((b) => b.dataset.action)]));
  },
  /** Open a row's detail in the roster and read its ledger: the toggles and the read-only ticks it draws. */
  rosterLedger: async ({ actorId, press }) => {
    const H = globalThis.__oc;
    const row = () => H.root(H.roster)?.querySelector(`.acks-extras-roster__row[data-actor-id="${actorId}"]`);
    if (!row()?.classList.contains("is-open")) row()?.querySelector('[data-action="toggleRow"]')?.click();
    await H.poll(() => row()?.classList.contains("is-open"), { tries: 20, every: 150 });
    await H.sleep(300);
    const toggles = row()?.querySelectorAll('.acks-extras-roster__detail [data-action="toggleCompensated"]') ?? [];
    const ticks = row()?.querySelectorAll(".acks-extras-roster__detail .fa-check") ?? [];
    const out = { open: !!row()?.classList.contains("is-open"), toggles: toggles.length, ticks: ticks.length, changed: false };
    if (press && toggles.length) {
      const a = game.actors.get(actorId);
      const before = JSON.stringify((a.getFlag("acks-extras", "record") ?? {}).loyalty?.permanents ?? []);
      toggles[0].click();
      out.changed = !!(await H.poll(() => JSON.stringify((a.getFlag("acks-extras", "record") ?? {}).loyalty?.permanents ?? []) !== before, { tries: 24, every: 250 }));
    }
    return out;
  },
  /**
   * Press a row control in the open Roster and answer the dialog it opens:
   * Calamity types a note, Penalty and Dismiss confirm the default, Transfer
   * reads its options and picks `pick` when given. Returns what the dialog held.
   */
  rosterPress: async ({ actorId, action, pick }) => {
    const H = globalThis.__oc;
    for (const app of H.apps()) if (app.element?.classList?.contains("dialog")) await app.close({ force: true });
    const row = H.root(H.roster)?.querySelector(`.acks-extras-roster__row[data-actor-id="${actorId}"]`);
    const button = row?.querySelector(`.acks-extras-frame__ctls [data-action="${action}"]`);
    if (!button) return { pressed: false };
    button.click();
    const dialog = await H.poll(() => document.querySelector(".application.dialog"), { tries: 30, every: 200 });
    if (!dialog) return { pressed: true, dialog: false };
    const out = { pressed: true, dialog: true, options: [], answered: false };
    if (action === "transfer") {
      const select = dialog.querySelector('select[name="employerId"]');
      out.options = [...(select?.options ?? [])].map((o) => o.value);
      out.optionsOwned = out.options.every((id) => game.actors.get(id)?.isOwner === true);
      if (select && pick) select.value = pick;
    }
    if (action === "calamity") dialog.querySelector('input[name="note"]').value = "owner-controls";
    const ok = dialog.querySelector('button[data-action="ok"], button[data-action="yes"]');
    if (ok) { ok.click(); out.answered = true; }
    return out;
  },
  rosterClose: async () => {
    const H = globalThis.__oc;
    if (H.roster) await H.roster.close();
    H.roster = null;
    return true;
  },
  drain: async () => ({ errors: (globalThis.__oc?.errors ?? []).slice() }),
  restore: async () => {
    const H = globalThis.__oc;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    for (const [name, id] of H.hookIds) Hooks.off(name, id);
    if (H.roster) await H.roster.close();
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.henchmen?.openRosterApp`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let player = null;
let autoRollBefore = null;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 480_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const track = async (uuid, kind) => { if (!uuid || made.includes(uuid)) return; made.push(uuid); await gm.track(uuid, kind); };
/** How many events of `type` a read record holds. */
const count = (read, type) => read.events.filter((e) => e === type).length;
/** Track every chat card the GM seat has received that speaks as a fixture, by id. */
const trackCards = async (actorIds) => {
  const got = await run(gm, P.cards, { actorIds });
  for (const uuid of got.uuids) await track(uuid, "ChatMessage");
  return got;
};
/** The throw windows the Player seat rendered or holds since the last mark: none is the pass. */
const noThrowOnPlayer = async () => {
  const w = await run(player, P.throwWindows);
  return { ok: w.rendered === 0 && w.open === 0, ...w };
};

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const gi = await run(gm, P.install);
  check("the GM seat is a GM", gi.isGM, gi);
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const pi = await run(player, P.install);
  check("the Player seat is not a GM", !pi.isGM, { isGM: pi.isGM });

  section("fixtures");
  const make = (name) => ({ name, type: "character", prototypeToken: { actorLink: true } });
  const docs = {
    employer: await gm.fixture(MARKERS.employer, "Actor", make("QA Owner Employer")),
    employer2: await gm.fixture(MARKERS.employer2, "Actor", make("QA Owner Employer Two")),
    foreignEmployer: await gm.fixture(MARKERS.foreignEmployer, "Actor", make("QA Foreign Employer")),
    hireling: await gm.fixture(MARKERS.hireling, "Actor", make("QA Owner Hireling")),
    merc: await gm.fixture(MARKERS.merc, "Actor", make("QA Owner Mercenary")),
    foreignHireling: await gm.fixture(MARKERS.foreignHireling, "Actor", make("QA Owner Foreign Hireling")),
    dismiss: await gm.fixture(MARKERS.dismiss, "Actor", make("QA Owner Dismiss")),
  };
  const ids = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.id]));
  const fixtureIds = Object.values(ids);
  const shape = (serve) => run(gm, P.shape, { ids, playerId, serve });

  autoRollBefore = await run(gm, P.readSetting, { key: "autoRollCalamity" });
  note("world autoRollCalamity at the start", autoRollBefore);

  /* -------------------------------------------------------------- */
  section("toggle");
  const s1 = await shape(["hireling", "merc", "foreignHireling"]);
  check("toggle: the employer is the Player's, the hireling is served and the Player's, the foreign hireling is served and not the Player's", s1.employerOwned && s1.hireling.serves && s1.hireling.playerOwns && s1.foreignHireling.serves && !s1.foreignHireling.playerOwns, s1);
  const l1 = await run(gm, P.setLedger, { actorId: ids.hireling, entries: [{ delta: ENTRY_DELTA, note: ENTRY_NOTE, compensated: false }] });
  const l2 = await run(gm, P.setLedger, { actorId: ids.foreignHireling, entries: [{ delta: ENTRY_DELTA, note: ENTRY_NOTE, compensated: true }] });
  check("toggle: the Player's hireling carries one uncompensated entry and the foreign one a compensated entry", l1.entries === 1 && l1.compensated === 0 && l2.entries === 1 && l2.compensated === 1, { hireling: l1, foreign: l2 });
  const t0 = await run(player, P.read, { actorId: ids.hireling });
  note("loyalty figure read at the start", t0.score !== null);

  const svc = await run(player, P.serviceToggle, { actorId: ids.hireling, press: true });
  const t1 = await run(player, P.read, { actorId: ids.hireling });
  check("toggle: the Player's Service tab draws the toggle as a named button", svc.rendered && svc.drawn && svc.named, svc);
  check("toggle: pressing it compensates the entry, logs an adjustment and leaves the entry in the ledger", svc.changed && t1.ownCompensated === true && t1.entries.length === 1 && t1.events.length === t0.events.length + 1 && t1.events.at(-1) === "adjustment", { changed: svc.changed, ownCompensated: t1.ownCompensated, events: t1.events.length - t0.events.length });
  if (t0.score === null) note("toggle: the loyalty figure is blank on this world; its movement is not compared", true);
  else check("toggle: the loyalty figure moves by the entry's delta", t1.score === t0.score - ENTRY_DELTA, { before: t0.score, after: t1.score, delta: ENTRY_DELTA });

  const open1 = await run(player, P.rosterOpen, { employerId: ids.employer });
  check("toggle: the Player's Roster window opens", open1.opened, open1);
  const rl = await run(player, P.rosterLedger, { actorId: ids.hireling, press: true });
  const t2 = await run(player, P.read, { actorId: ids.hireling });
  check("toggle: the Player's Roster row draws the toggle on the entry", rl.open && rl.toggles === 1, rl);
  check("toggle: pressing it in the Roster restores the entry and the figure", rl.changed && t2.ownCompensated === false && t2.score === t0.score && t2.events.at(-1) === "adjustment", { changed: rl.changed, ownCompensated: t2.ownCompensated, scoreBack: t2.score === t0.score });
  const fl = await run(player, P.rosterLedger, { actorId: ids.foreignHireling, press: false });
  check("toggle: the foreign hireling's Roster row draws the read-only tick and no toggle", fl.open && fl.toggles === 0 && fl.ticks >= 1, fl);
  await run(player, P.rosterClose);

  /* -------------------------------------------------------------- */
  section("roster");
  const s2 = await shape(["hireling", "merc", "foreignHireling"]);
  check("roster: the three hirelings are served, the first and the mercenary the Player's, the mercenary of its category; the second employer is the Player's and out of service; the foreign employer is not the Player's", s2.hireling.serves && s2.hireling.playerOwns && s2.merc.serves && s2.merc.playerOwns && s2.merc.category === "mercenary" && s2.foreignHireling.serves && !s2.foreignHireling.playerOwns && s2.employer2Owned && s2.employer2Idle && s2.foreignEmployerNotOwned && s2.foreignEmployerIdle, s2);
  const open2 = await run(player, P.rosterOpen, { employerId: ids.employer });
  check("roster: the Player opens the Roster of the first employer", open2.opened, open2);
  const ctl = await run(player, P.rosterControls);
  const has = (id, ...names) => names.every((n) => (ctl[id] ?? []).includes(n));
  const lacks = (id, ...names) => names.every((n) => !(ctl[id] ?? []).includes(n));
  check("roster: the henchman row draws Calamity, Penalty, Transfer and Dismiss, and no loyalty or obedience dice", has(ids.hireling, "calamity", "penalty", "transfer", "dismiss") && lacks(ids.hireling, "loyaltyRoll", "obedienceRoll"), ctl[ids.hireling]);
  check("roster: the mercenary row draws Morale, Transfer and Dismiss, and no Calamity, Penalty or dice", has(ids.merc, "moraleRoll", "transfer", "dismiss") && lacks(ids.merc, "calamity", "penalty", "loyaltyRoll", "obedienceRoll"), ctl[ids.merc]);
  check("roster: the foreign hireling's row draws no Calamity, Penalty, Transfer or Dismiss", lacks(ids.foreignHireling, "calamity", "penalty", "transfer", "dismiss"), ctl[ids.foreignHireling]);

  // Calamity, with the auto-roll setting held each way. The throw is the
  // Judge's secret, so no throw window may open on the Player seat either way.
  for (const value of [true, false]) {
    await run(gm, P.setting, { key: "autoRollCalamity", value });
    let seen = await run(player, P.readSetting, { key: "autoRollCalamity" });
    for (let n = 0; n < 24 && seen !== value; n++) { await sleep(250); seen = await run(player, P.readSetting, { key: "autoRollCalamity" }); }
    check(`roster: the Player seat reads autoRollCalamity as ${value}`, seen === value, { seen });
    const before = await run(player, P.read, { actorId: ids.hireling });
    const gmCardsBefore = (await run(gm, P.cards, { actorIds: fixtureIds, actorId: ids.hireling })).calamityCards.length;
    await run(player, P.markRender);
    const press = await run(player, P.rosterPress, { actorId: ids.hireling, action: "calamity" });
    const landed = await run(player, P.read, { actorId: ids.hireling }).then(async (r) => {
      for (let n = 0; n < 24 && r.calamities === before.calamities; n++) { await sleep(250); r = await run(player, P.read, { actorId: ids.hireling }); }
      return r;
    });
    await sleep(1500);
    check(`roster: Calamity (auto-roll ${value}) is answered and counts one calamity and logs a calamity event`, press.pressed && press.dialog && press.answered && landed.calamities === before.calamities + 1 && count(landed, "calamity") === count(before, "calamity") + 1, { pressed: press.pressed, dialog: press.dialog, answered: press.answered, calamities: landed.calamities - before.calamities });
    const w = await noThrowOnPlayer();
    check(`roster: no loyalty-throw window opens on the Player seat (auto-roll ${value})`, w.ok, w);
    let card = null;
    for (let n = 0; n < 24 && !card; n++) {
      const got = await run(gm, P.cards, { actorIds: fixtureIds, actorId: ids.hireling });
      card = got.calamityCards.length > gmCardsBefore ? got.calamityCards.at(-1) : null;
      if (!card) await sleep(250);
    }
    check(`roster: the GM seat receives the calamity card with its loyalty button (auto-roll ${value})`, !!card);
    await trackCards(fixtureIds);
    const own = await run(player, P.seenCard, { actorId: ids.hireling });
    if (own) {
      await run(player, P.markRender);
      const eventsBefore = (await run(player, P.read, { actorId: ids.hireling })).events.length;
      const throwPress = await run(player, P.pressCard, { messageId: own.id, action: "rollLoyaltySecret" });
      const waivePress = await run(player, P.pressCard, { messageId: own.id, action: "waiveCalamityRoll" });
      const after = await run(player, P.read, { actorId: ids.hireling });
      const w2 = await noThrowOnPlayer();
      check(`roster: the Player pressing the card's throw and waive buttons opens no window and logs nothing (auto-roll ${value})`, throwPress.found && waivePress.found && w2.ok && after.events.length === eventsBefore, { throwFound: throwPress.found, waiveFound: waivePress.found, windows: w2, logged: after.events.length - eventsBefore });
    } else check(`roster: the Player seat holds the calamity card it authored (auto-roll ${value})`, false);
  }

  // Penalty
  const pen0 = await run(player, P.read, { actorId: ids.hireling });
  const pen = await run(player, P.rosterPress, { actorId: ids.hireling, action: "penalty" });
  let pen1 = pen0;
  for (let n = 0; n < 24 && pen1.entries.length === pen0.entries.length; n++) { await sleep(250); pen1 = await run(player, P.read, { actorId: ids.hireling }); }
  check("roster: Penalty is answered and adds one uncompensated entry to the ledger", pen.dialog && pen.answered && pen1.entries.length === pen0.entries.length + 1 && pen1.entries.at(-1).compensated === false, { dialog: pen.dialog, added: pen1.entries.length - pen0.entries.length });

  // Transfer, with auto-roll on so a throw would open if it could.
  await run(gm, P.setting, { key: "autoRollCalamity", value: true });
  await sleep(500);
  const s3 = await shape(["hireling"]);
  check("roster: the hireling serves the first employer at the step's start", s3.hireling.serves, s3.hireling);
  await run(player, P.markRender);
  const hBefore = await run(player, P.read, { actorId: ids.hireling });
  const tr = await run(player, P.rosterPress, { actorId: ids.hireling, action: "transfer", pick: ids.employer2 });
  check("roster: the Transfer select lists the Player's other character and not the character the Player does not own", tr.dialog && tr.options.includes(ids.employer2) && !tr.options.includes(ids.foreignEmployer) && !tr.options.includes(ids.employer) && tr.optionsOwned, { options: tr.options.length, hasSecond: tr.options.includes(ids.employer2), hasForeign: tr.options.includes(ids.foreignEmployer), allOwned: tr.optionsOwned });
  let moved = hBefore;
  for (let n = 0; n < 40 && moved.managerid !== ids.employer2; n++) { await sleep(250); moved = await run(player, P.read, { actorId: ids.hireling }); }
  await sleep(1500);
  moved = await run(player, P.read, { actorId: ids.hireling });
  const employer2Uuid = `Actor.${ids.employer2}`;
  check("roster: the transfer moves the hireling: its manager and the record's employer name the second employer, and it is listed by it alone", tr.answered && moved.managerid === ids.employer2 && moved.employerUuid === employer2Uuid && moved.listedBy.join(",") === ids.employer2, { answered: tr.answered, manager: moved.managerid === ids.employer2, employerUuid: moved.employerUuid === employer2Uuid, listedBy: moved.listedBy.length });
  const wt = await noThrowOnPlayer();
  check("roster: the transfer's calamity opens no loyalty-throw window on the Player seat (auto-roll on)", wt.ok, wt);
  check("roster: the transfer's calamity is counted and logged", moved.calamities === hBefore.calamities + 1 && moved.events.includes("transfer"), { calamities: moved.calamities - hBefore.calamities, transfer: moved.events.includes("transfer") });
  await trackCards(fixtureIds);
  await run(gm, P.setting, { key: "autoRollCalamity", value: autoRollBefore });
  await run(player, P.rosterClose);

  // Dismiss, last, on its own fixture.
  await run(gm, P.resetEvents, { actorId: ids.dismiss });
  const s4 = await shape(["dismiss"]);
  check("roster: the dismiss fixture serves the first employer at the step's start", s4.dismiss.serves && s4.dismiss.playerOwns, s4.dismiss);
  await run(player, P.rosterOpen, { employerId: ids.employer });
  const dm = await run(player, P.rosterPress, { actorId: ids.dismiss, action: "dismiss" });
  let gone = await run(player, P.read, { actorId: ids.dismiss });
  for (let n = 0; n < 24 && gone.listedBy.length; n++) { await sleep(250); gone = await run(player, P.read, { actorId: ids.dismiss }); }
  check("roster: Dismiss takes the hireling off the employer's list, clears its manager and logs a dismissal", dm.dialog && dm.answered && gone.listedBy.length === 0 && gone.managerid === "" && gone.events.includes("dismissed"), { answered: dm.answered, listedBy: gone.listedBy.length, manager: gone.managerid === "", dismissed: gone.events.includes("dismissed") });
  note("retainer switch of the dismissed character (core's removal leaves it as it was)", gone.enabled);
  await run(player, P.rosterClose);

  await trackCards(fixtureIds);
  const pe = await run(player, P.drain);
  const ge = await run(gm, P.drain);
  check("no console error on either seat from install to the end of the walk", !pe.errors.length && !ge.errors.length, { player: pe.errors.length, gm: ge.errors.length });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && autoRollBefore != null) {
    try { note("autoRollCalamity restored", await run(gm, P.setting, { key: "autoRollCalamity", value: autoRollBefore })); } catch (err) { console.error("restore setting:", err?.message ?? err); }
  }
  if (gm && made.length) {
    try { note("swept", await gm.sweepTracked({ only: made })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixtures kept: ${Object.values(MARKERS).join(", ")}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
