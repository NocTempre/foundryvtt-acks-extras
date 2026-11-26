/**
 * Live walk, henchmen-transfer-ownership: a roster transfer moves the
 * hireling's ownership with it. Walks docs/henchmen/TESTING.md steps 6 and 6a
 * ("Transfer carries ownership, GM seat and two Player seats"). Machine values
 * arrive through ./_env.mjs.
 *
 * Seats: the GM seat, Player A (the machine's Player seat) and Player B, a
 * second Player-role user found by role on the GM seat and joined on the second
 * GM seat's port, the only spare one `_env.mjs` names. A seat that cannot be
 * joined (no second Player user, that user already seated by another client,
 * the join refused) skips what it alone could show and says why.
 *
 * Step 6a: `henchmen/swap-from` is Player A's and `henchmen/swap-to` is Player
 * B's alone, with explicit levels written first and each asserted; the
 * hireling `henchmen/swap-hireling` serves the first and is Player A's. The GM
 * seat presses Transfer in the Roster window. What the hireling's `ownership`
 * holds is read back on the GM seat, on A's seat and on B's seat and printed
 * with each key named by role (A, B, gm, default, other), `_source` beside it:
 * whether Foundry lets the forced deletion remove A's key is the open question,
 * so "A holds no Owner level" and "A has no key" are two checks. `isOwner` on
 * the hireling is read on both Player seats (B true, A false), B's Roster draws
 * the row's controls and A's draws none, and the GM seat records no
 * `transferOwnershipFailed` warning.
 *
 * Step 6: Player A's own transfer between two characters A owns
 * (`henchmen/owner-employer` to `henchmen/owner-employer-2`, hireling
 * `henchmen/owner-hireling`): the move stands, A is still Owner of the
 * hireling with its key, and a refusal warning, if the seat raised one, is
 * printed and not asserted. The step leaves the hireling on the second
 * employer; the next shape puts it back.
 *
 * The world's `autoRollCalamity` is held off for the run so the GM seat's
 * transfer posts a card and opens no throw window, and is restored. The cards
 * the transfers post speak as a fixture; the GM seat lists them by id as they
 * arrive and sweeps those ids alone. Fixtures stay, found by marker. Every
 * figure printed is a count, a level or a boolean.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKERS = {
  swapFrom: "henchmen/swap-from",
  swapTo: "henchmen/swap-to",
  swapHireling: "henchmen/swap-hireling",
  ownerEmployer: "henchmen/owner-employer",
  ownerEmployer2: "henchmen/owner-employer-2",
  ownerHireling: "henchmen/owner-hireling",
};
/** The lang key the roster's warning for a refused ownership write is read from. */
const OWNERSHIP_WARN_KEY = "ACKS-HENCHMEN.roster.transferOwnershipFailed";
/** The four controls a henchman row draws for an owner. */
const HENCHMAN_CONTROLS = ["calamity", "penalty", "transfer", "dismiss"];

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const skip = (label, reason) => console.log(`SKIP  ${label}  ${reason}`);

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ot = globalThis.__ot ?? {});
    const M = "/modules/acks-extras/scripts/henchmen";
    H.HI = await import(`${M}/engine/hire.mjs`);
    H.AD = await import(`${M}/acks-adapter.mjs`);
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : (app?.element?.[0] ?? null));
    H.apps = () => [...foundry.applications.instances.values()];
    // A user's key in an ownership object, named by role so a line can be quoted.
    H.label = (uid, idA, idB) => (uid === "default" ? "default" : uid === idA ? "A" : uid === idB ? "B" : (game.users.get(uid)?.isGM ? "gm" : "other"));
    H.keys = (own, idA, idB) => Object.entries(own ?? {}).map(([u, l]) => `${H.label(u, idA, idB)}:${l}`).sort();
    H.snap = (id, idA, idB) => {
      const a = game.actors.get(id);
      const owner = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
      if (!a) return { present: false, isOwner: false, keys: [], source: [], A: null, B: null, hasA: false, hasB: false, default: null, owner };
      const own = a.ownership ?? {};
      return {
        present: true,
        isOwner: a.isOwner === true,
        keys: H.keys(own, idA, idB),
        source: H.keys(a._source?.ownership, idA, idB),
        A: idA in own ? own[idA] : null,
        B: idB && idB in own ? own[idB] : null,
        hasA: idA in own,
        hasB: !!idB && idB in own,
        default: own.default ?? null,
        owner,
      };
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.warns = [];
      H.notes = [];
      H.consoleError = console.error;
      H.consoleWarn = console.warn;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      console.warn = (...args) => { H.warns.push(String(args[0] ?? "").slice(0, 200)); H.consoleWarn(...args); };
      H.noteOrig = {};
      for (const k of ["info", "warn", "error"]) {
        H.noteOrig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.noteOrig[k].call(this, msg, ...rest);
        };
      }
      // Every chat message this seat receives, with the actor it speaks as.
      H.msgs = [];
      H.hookIds = [["createChatMessage", Hooks.on("createChatMessage", (m) => H.msgs.push({ uuid: m.uuid, actor: m.speaker?.actor ?? null }))]];
    }
    return { isGM: game.user.isGM };
  },
  setting: async ({ key, value }) => {
    const before = game.settings.get("acks-extras", key);
    if (value !== undefined && value !== before) await game.settings.set("acks-extras", key, value);
    return { before, now: game.settings.get("acks-extras", key) };
  },
  /**
   * GM seat. The Player seat's user id by name, and the other Player-role users
   * (names are for joining only, never printed): whether each is seated now.
   */
  users: async ({ nameA }) => {
    const idA = game.users.getName(nameA)?.id ?? null;
    const roles = CONST.USER_ROLES;
    const others = game.users
      .filter((u) => !u.isGM && u.id !== idA && u.role >= roles.PLAYER)
      .map((u) => ({ id: u.id, name: u.name, active: u.active === true, exact: u.role === roles.PLAYER }))
      .sort((x, y) => Number(y.exact) - Number(x.exact) || x.id.localeCompare(y.id));
    return { idA, others };
  },
  /**
   * GM seat. Put a trio in the shape a step needs: both employers linked and
   * owned by exactly `ownersFrom` / `ownersTo` at the Owner level (default
   * None), the second out of service, and the hireling a henchman of the first
   * owned by exactly `ownersHireling`. Levels are written explicitly; no key is
   * removed except an unwanted Player's. Returns each document's ownership as
   * named by role and the booleans the step asserts.
   */
  shape: async ({ ids, idA, idB, ownersFrom, ownersTo, ownersHireling }) => {
    const H = globalThis.__ot;
    const OWN = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const doc = (k) => game.actors.get(ids[k]);
    const setOwners = async (a, userIds) => {
      const own = a.ownership ?? {};
      const diff = {};
      for (const uid of Object.keys(own)) {
        if (uid === "default" || game.users.get(uid)?.isGM) continue;
        if (!userIds.includes(uid)) diff[`ownership.-=${uid}`] = null;
      }
      for (const uid of userIds) if (own[uid] !== OWN.OWNER) diff[`ownership.${uid}`] = OWN.OWNER;
      if (own.default !== OWN.NONE) diff["ownership.default"] = OWN.NONE;
      if (Object.keys(diff).length) await a.update(diff);
    };
    const from = doc("from");
    const to = doc("to");
    const hireling = doc("hireling");
    for (const a of [from, to]) if (!a.prototypeToken.actorLink) await a.update({ "prototypeToken.actorLink": true });
    // Core's removal clears the manager and leaves the retainer switch on, so the second employer is switched off explicitly.
    if (to.system.retainer?.enabled) await H.AD.setRetainer(to, { enabled: false, managerid: "" });
    await setOwners(from, ownersFrom);
    await setOwners(to, ownersTo);
    // Core's roster refuses a character another actor already lists.
    for (const x of game.actors.filter((x) => x.id !== from.id && (x.system.henchmenList ?? []).includes(hireling.id))) await H.AD.delHenchman(x, hireling.id);
    if (!hireling.system.retainer?.enabled) await H.HI.enrollHenchman(from, hireling, { loyalty: 2 });
    else if (!(from.system.henchmenList ?? []).includes(hireling.id)) await H.AD.addHenchman(from, hireling.id);
    if (hireling.system.retainer?.managerid !== from.id) await H.AD.setRetainer(hireling, { managerid: from.id });
    if (hireling.system.retainer?.category !== "henchman") await H.AD.setRetainer(hireling, { category: "henchman" });
    const record = hireling.getFlag("acks-extras", "record") ?? {};
    if (record.employerUuid !== from.uuid) await hireling.setFlag("acks-extras", "record", { ...record, employerUuid: from.uuid });
    await setOwners(hireling, ownersHireling);
    const userA = game.users.get(idA);
    const userB = idB ? game.users.get(idB) : null;
    const view = (a) => ({ ...H.snap(a.id, idA, idB), permA: a.testUserPermission(userA, "OWNER"), permB: userB ? a.testUserPermission(userB, "OWNER") : null });
    return {
      from: { ...view(from), linked: from.prototypeToken.actorLink === true },
      to: { ...view(to), linked: to.prototypeToken.actorLink === true, idle: !to.system.retainer?.enabled },
      hireling: {
        ...view(hireling),
        serves: hireling.system.retainer?.enabled === true && hireling.system.retainer?.managerid === from.id && (from.system.henchmenList ?? []).includes(hireling.id),
        listedBy: game.actors.filter((x) => (x.system.henchmenList ?? []).includes(hireling.id)).map((x) => x.id),
      },
    };
  },
  /** What a hireling's record and lists say on this seat, and its ownership as named by role. */
  read: async ({ hirelingId, idA, idB }) => {
    const H = globalThis.__ot;
    const a = game.actors.get(hirelingId);
    if (!a) return { present: false, snap: H.snap(hirelingId, idA, idB) };
    const r = a.getFlag("acks-extras", "record") ?? {};
    return {
      present: true,
      managerid: a.system.retainer?.managerid ?? "",
      employerUuid: r.employerUuid ?? "",
      events: (r.events ?? []).map((e) => e.type),
      listedBy: game.actors.filter((x) => (x.system.henchmenList ?? []).includes(a.id)).map((x) => x.id),
      snap: H.snap(hirelingId, idA, idB),
    };
  },
  snap: async ({ id, idA, idB }) => globalThis.__ot.snap(id, idA, idB),
  /** A mark in this seat's notification and console-warning logs. */
  mark: async () => ({ notes: globalThis.__ot.notes.length, warns: globalThis.__ot.warns.length }),
  /** The ownership-failed warning this seat raised since `mark`, other errors raised, and the module's own console line. */
  notesSince: async ({ mark, hirelingId }) => {
    const H = globalThis.__ot;
    const name = game.actors.get(hirelingId)?.name ?? "";
    const wanted = game.i18n.format("ACKS-HENCHMEN.roster.transferOwnershipFailed", { name });
    const seen = H.notes.slice(mark.notes);
    return {
      ownershipWarn: seen.filter((n) => n.kind === "warn" && n.text === wanted).length,
      otherWarn: seen.filter((n) => n.kind === "warn" && n.text !== wanted).length,
      errors: seen.filter((n) => n.kind === "error").length,
      consoleLines: H.warns.slice(mark.warns).filter((w) => /transfer (ownership write|roster ops) failed/.test(w)),
    };
  },
  /**
   * Open `employerId`'s Roster window on this seat and read the hireling's row:
   * whether the employer is visible to this seat at all, whether the window
   * opened, whether the row is drawn, and the controls in its strip. With
   * `press` ("transfer") the control is pressed and its dialog answered with
   * `pick`; the dialog's options are returned.
   */
  roster: async ({ employerId, hirelingId, press, pick, tries }) => {
    const H = globalThis.__ot;
    const employer = game.actors.get(employerId);
    if (!employer) return { employerVisible: false, opened: false, row: false, controls: [] };
    if (H.roster) await H.roster.close();
    acksExtras.henchmen.openRosterApp(employer);
    H.roster = await H.poll(() => H.apps().find((a) => a.constructor?.name === "RosterApp" && a.employer?.id === employerId && a.rendered && H.root(a)) ?? null, { tries: 30 });
    if (!H.roster) return { employerVisible: true, opened: false, row: false, controls: [] };
    const rowOf = () => H.root(H.roster)?.querySelector(`.acks-extras-roster__row[data-actor-id="${hirelingId}"]`);
    await H.poll(() => rowOf(), { tries: tries ?? 40 });
    const row = rowOf();
    const controls = [...(row?.querySelectorAll(".acks-extras-frame__ctls [data-action]") ?? [])].map((b) => b.dataset.action);
    const out = { employerVisible: true, opened: true, row: !!row, controls };
    if (press && row) {
      for (const app of H.apps()) if (app.element?.classList?.contains("dialog")) await app.close({ force: true });
      const button = row.querySelector(`.acks-extras-frame__ctls [data-action="${press}"]`);
      if (!button) return { ...out, pressed: false };
      button.click();
      const dialog = await H.poll(() => document.querySelector(".application.dialog"), { tries: 30, every: 200 });
      out.pressed = true;
      out.dialog = !!dialog;
      if (dialog) {
        const select = dialog.querySelector('select[name="employerId"]');
        out.options = [...(select?.options ?? [])].map((o) => o.value);
        if (select && pick) select.value = pick;
        const ok = dialog.querySelector('button[data-action="ok"], button[data-action="yes"]');
        if (ok) { ok.click(); out.answered = true; }
      }
    }
    return out;
  },
  rosterClose: async () => {
    const H = globalThis.__ot;
    if (H?.roster) await H.roster.close();
    if (H) H.roster = null;
    return true;
  },
  /** The throw windows this seat holds open, closed. */
  closeThrow: async () => {
    const H = globalThis.__ot;
    let n = 0;
    for (const app of H.apps()) if (["ThrowDialog", "InfluenceApp"].includes(app.constructor?.name)) { n += 1; await app.close({ force: true }); }
    return n;
  },
  /** The uuids of the chat messages this seat received that speak as one of `actorIds`. */
  cards: async ({ actorIds }) => globalThis.__ot.msgs.filter((m) => actorIds.includes(m.actor)).map((m) => m.uuid),
  drain: async () => ({ errors: (globalThis.__ot?.errors ?? []).slice() }),
  restore: async () => {
    const H = globalThis.__ot;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    console.warn = H.consoleWarn;
    for (const [k, fn] of Object.entries(H.noteOrig)) ui.notifications[k] = fn;
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
let playerA = null;
let playerB = null;
let autoRollBefore = null;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 480_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  for (const seat of [playerB, playerA, gm]) { try { seat?.close(); } catch {} }
  process.exit(1);
}, WALL_MS).unref();

const track = async (uuid, kind) => { if (!uuid || made.includes(uuid)) return; made.push(uuid); await gm.track(uuid, kind); };
/** Track every chat card the GM seat has received that speaks as one of `actorIds`, by uuid. */
const trackCards = async (actorIds) => {
  for (const uuid of await run(gm, P.cards, { actorIds })) await track(uuid, "ChatMessage");
};
/** A step runs in its own try: a throw is a failed check and the next step still runs. */
const step = async (name, fn) => {
  section(name);
  try { await fn(); } catch (err) { check(`${name}: the step ran to its end`, false, String(err?.message ?? err).slice(0, 300)); }
};
const poll = async (read, until, tries = 40, every = 250) => {
  let v = await read();
  for (let n = 0; n < tries && !until(v); n++) { await sleep(every); v = await read(); }
  return v;
};

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  check("the GM seat is a GM", (await run(gm, P.install)).isGM);
  const who = await run(gm, P.users, { nameA: MACHINE.player });
  const idA = who.idA;
  if (!idA) throw new Error("no Player user on this world");
  playerA = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player A ready after (s)", await ready(playerA, "player A"));
  check("Player A's seat is not a GM", !(await run(playerA, P.install)).isGM);

  // Player B: another Player-role user, joined on the second GM seat's port, which is the only spare one the machine names.
  const candidate = who.others.find((u) => !u.active) ?? null;
  const idB = candidate?.id ?? who.others[0]?.id ?? null;
  let bSkip = null;
  if (!candidate) bSkip = who.others.length ? "every other Player-role user is already seated by another client, and this walk drives no peer's seat" : "this world has no second Player-role user";
  else {
    try {
      playerB = await connect({ browser, origin, user: candidate.name, port: PORTS.gm2, own: MACHINE.own });
      await ready(playerB, "player B");
      const bi = await run(playerB, P.install);
      check("Player B's seat is not a GM and is a different user from Player A's", !bi.isGM && candidate.id !== idA, { isGM: bi.isGM });
    } catch (err) {
      bSkip = `Player B's seat could not be joined: ${String(err?.message ?? err).slice(0, 160)}`;
      try { await playerB?.close(); } catch {}
      playerB = null;
    }
  }
  if (bSkip) note("Player B", bSkip);

  section("fixtures");
  const make = (name) => ({ name, type: "character", prototypeToken: { actorLink: true } });
  const docs = {
    swapFrom: await gm.fixture(MARKERS.swapFrom, "Actor", make("QA Swap From")),
    swapTo: await gm.fixture(MARKERS.swapTo, "Actor", make("QA Swap To")),
    swapHireling: await gm.fixture(MARKERS.swapHireling, "Actor", make("QA Swap Hireling")),
    ownerEmployer: await gm.fixture(MARKERS.ownerEmployer, "Actor", make("QA Owner Employer")),
    ownerEmployer2: await gm.fixture(MARKERS.ownerEmployer2, "Actor", make("QA Owner Employer Two")),
    ownerHireling: await gm.fixture(MARKERS.ownerHireling, "Actor", make("QA Owner Hireling")),
  };
  const ids = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.id]));
  const fixtureIds = Object.values(ids);
  autoRollBefore = (await run(gm, P.setting, { key: "autoRollCalamity" })).before;
  note("world autoRollCalamity at the start", autoRollBefore);
  note("autoRollCalamity held for the run", (await run(gm, P.setting, { key: "autoRollCalamity", value: false })).now);

  /* -------------------------------------------------------------- */
  await step("6a: transfer carries ownership, GM seat and two Player seats", async () => {
    if (!idB) return skip("6a", bSkip ?? "no second Player-role user to be the new employer's owner");
    const sh = await run(gm, P.shape, { ids: { from: ids.swapFrom, to: ids.swapTo, hireling: ids.swapHireling }, idA, idB, ownersFrom: [idA], ownersTo: [idB], ownersHireling: [idA] });
    const owner = sh.from.owner;
    check("6a setup: swap-from is linked and Player A's alone (explicit Owner, default none, B not an owner)", sh.from.linked && sh.from.A === owner && sh.from.default === 0 && sh.from.permB === false, sh.from.keys);
    check("6a setup: swap-to is linked, out of service and Player B's alone (explicit Owner, default none, A not an owner)", sh.to.linked && sh.to.idle && sh.to.B === owner && sh.to.default === 0 && sh.to.permA === false, sh.to.keys);
    check("6a setup: swap-hireling serves swap-from alone, is Player A's, and B is not an owner", sh.hireling.serves && sh.hireling.listedBy.join(",") === ids.swapFrom && sh.hireling.A === owner && sh.hireling.permB === false, sh.hireling.keys);
    note("6a hireling ownership before the transfer", sh.hireling.keys);
    if (!(sh.from.A === owner && sh.to.B === owner && sh.hireling.A === owner)) return skip("6a transfer", "the fixtures are not in the shape the step needs");

    const mark = await run(gm, P.mark);
    const tr = await run(gm, P.roster, { employerId: ids.swapFrom, hirelingId: ids.swapHireling, press: "transfer", pick: ids.swapTo });
    check("6a: the GM's Roster of swap-from draws the hireling's Transfer and its select lists swap-to", tr.pressed && tr.dialog && tr.options.includes(ids.swapTo) && tr.answered, { pressed: tr.pressed, dialog: tr.dialog, answered: tr.answered, listsTo: tr.options?.includes(ids.swapTo) });

    const toUuid = `Actor.${ids.swapTo}`;
    const rd = (seat) => () => run(seat, P.read, { hirelingId: ids.swapHireling, idA, idB });
    const moved = await poll(rd(gm), (r) => r.employerUuid === toUuid);
    // The ownership write follows the record; wait for B's level to show on the GM seat, then let the calamity settle.
    const gmOwn = await poll(() => run(gm, P.snap, { id: ids.swapHireling, idA, idB }), (s) => s.B === owner, 40);
    await sleep(1500);
    const after = await rd(gm)();
    check("6a: the transfer moved the hireling: its manager and the record's employer name swap-to, and only swap-to lists it", moved.employerUuid === toUuid && after.managerid === ids.swapTo && after.listedBy.join(",") === ids.swapTo, { employerUuid: moved.employerUuid === toUuid, manager: after.managerid === ids.swapTo, listedBy: after.listedBy.length });
    const gmSnap = after.snap;
    note("6a hireling ownership read on the GM seat after the transfer (ownership)", gmSnap.keys);
    note("6a hireling ownership read on the GM seat after the transfer (_source)", gmSnap.source);
    check("6a: on the GM seat the hireling's ownership holds B at Owner", gmSnap.B === owner, { B: gmSnap.B });
    check("6a: on the GM seat A holds no Owner level on the hireling", gmSnap.A === null || gmSnap.A < owner, { A: gmSnap.A });
    check("6a: on the GM seat the hireling's ownership has no key for A (the forced deletion removed it)", gmSnap.hasA === false, { hasA: gmSnap.hasA, A: gmSnap.A, waitedForB: gmOwn.B === owner });
    const nt = await run(gm, P.notesSince, { mark, hirelingId: ids.swapHireling });
    check("6a: the GM seat raised no transferOwnershipFailed warning and no error", nt.ownershipWarn === 0 && nt.errors === 0, nt);
    note("6a warning key checked", OWNERSHIP_WARN_KEY);

    // Player A: the hireling leaves A's reach; A keeps its own employer.
    const aRead = await poll(() => run(playerA, P.snap, { id: ids.swapHireling, idA, idB }), (s) => !s.isOwner, 40);
    note("6a hireling ownership read on Player A's seat", { present: aRead.present, keys: aRead.keys, source: aRead.source });
    check("6a: on Player A's seat isOwner on the hireling is false", aRead.isOwner === false, { present: aRead.present, A: aRead.A });
    const aFrom = await run(playerA, P.snap, { id: ids.swapFrom, idA, idB });
    check("6a: Player A's own character swap-from is still A's (isOwner true)", aFrom.isOwner === true, { present: aFrom.present });
    const aRow = await run(playerA, P.roster, { employerId: ids.swapTo, hirelingId: ids.swapHireling, tries: 12 });
    check("6a: Player A's seat draws no control for the hireling (the row follows owned)", !HENCHMAN_CONTROLS.some((c) => aRow.controls.includes(c)), { employerVisible: aRow.employerVisible, opened: aRow.opened, row: aRow.row, controls: aRow.controls });
    await run(playerA, P.rosterClose);

    // Player B: the hireling arrives with B as its owner.
    if (!playerB) skip("6a Player B's seat", bSkip ?? "Player B's seat is not joined");
    else {
      const bRead = await poll(() => run(playerB, P.snap, { id: ids.swapHireling, idA, idB }), (s) => s.isOwner, 40);
      note("6a hireling ownership read on Player B's seat", { present: bRead.present, keys: bRead.keys, source: bRead.source });
      check("6a: on Player B's seat isOwner on the hireling is true and B's level is Owner", bRead.isOwner === true && bRead.B === owner, { present: bRead.present, B: bRead.B });
      const bRow = await run(playerB, P.roster, { employerId: ids.swapTo, hirelingId: ids.swapHireling });
      check("6a: Player B's Roster of swap-to draws the hireling's row with Calamity, Penalty, Transfer and Dismiss", bRow.row && HENCHMAN_CONTROLS.every((c) => bRow.controls.includes(c)), bRow);
      await run(playerB, P.rosterClose);
    }
    await run(gm, P.closeThrow);
    await trackCards(fixtureIds);
  });

  /* -------------------------------------------------------------- */
  await step("6: Player A's transfer between two characters A owns", async () => {
    const sh = await run(gm, P.shape, { ids: { from: ids.ownerEmployer, to: ids.ownerEmployer2, hireling: ids.ownerHireling }, idA, idB, ownersFrom: [idA], ownersTo: [idA], ownersHireling: [idA] });
    const owner = sh.from.owner;
    check("6 setup: both employers and the hireling are Player A's (explicit Owner), the second is out of service, the hireling serves the first alone", sh.from.A === owner && sh.to.A === owner && sh.hireling.A === owner && sh.to.idle && sh.hireling.serves && sh.hireling.listedBy.join(",") === ids.ownerEmployer, { from: sh.from.keys, to: sh.to.keys, hireling: sh.hireling.keys });
    if (!(sh.from.A === owner && sh.to.A === owner && sh.hireling.A === owner && sh.hireling.serves)) return skip("6 transfer", "the fixtures are not in the shape the step needs");
    // The hireling's ownership is on Player A's seat before the press, as the Judge's write reaches it.
    await poll(() => run(playerA, P.snap, { id: ids.ownerHireling, idA, idB }), (s) => s.isOwner, 40);
    await poll(() => run(playerA, P.read, { hirelingId: ids.ownerHireling, idA, idB }), (r) => r.present && r.managerid === ids.ownerEmployer, 40);
    const mark = await run(playerA, P.mark);
    const tr = await run(playerA, P.roster, { employerId: ids.ownerEmployer, hirelingId: ids.ownerHireling, press: "transfer", pick: ids.ownerEmployer2 });
    check("6: Player A's Roster draws Transfer on the hireling and the select lists the second employer", tr.pressed && tr.dialog && tr.options.includes(ids.ownerEmployer2) && tr.answered, { pressed: tr.pressed, dialog: tr.dialog, answered: tr.answered });
    const toUuid = `Actor.${ids.ownerEmployer2}`;
    const moved = await poll(() => run(playerA, P.read, { hirelingId: ids.ownerHireling, idA, idB }), (r) => r.employerUuid === toUuid);
    await sleep(2000);
    const after = await run(playerA, P.read, { hirelingId: ids.ownerHireling, idA, idB });
    check("6: the move stands: manager and record name the second employer, and it alone lists the hireling", moved.employerUuid === toUuid && after.managerid === ids.ownerEmployer2 && after.listedBy.join(",") === ids.ownerEmployer2, { employerUuid: moved.employerUuid === toUuid, manager: after.managerid === ids.ownerEmployer2, listedBy: after.listedBy.length });
    note("6 hireling ownership read on Player A's seat after the transfer", after.snap.keys);
    check("6: Player A is still Owner of the hireling: isOwner true and its key at Owner", after.snap.isOwner === true && after.snap.A === owner, { isOwner: after.snap.isOwner, A: after.snap.A });
    const gmSnap = await run(gm, P.snap, { id: ids.ownerHireling, idA, idB });
    note("6 hireling ownership read on the GM seat after the transfer", gmSnap.keys);
    check("6: on the GM seat the hireling's ownership still holds A at Owner (no deletion written)", gmSnap.A === owner, { A: gmSnap.A });
    const nt = await run(playerA, P.notesSince, { mark, hirelingId: ids.ownerHireling });
    note("6 transferOwnershipFailed warnings raised on Player A's seat (a refused write would raise one; reported, not asserted)", nt.ownershipWarn);
    check("6: Player A's seat raised no error notification", nt.errors === 0, nt);
    await run(playerA, P.rosterClose);
    await trackCards(fixtureIds);
  });

  await trackCards(fixtureIds);
  const drains = [];
  for (const seat of [gm, playerA, playerB]) if (seat) drains.push((await run(seat, P.drain)).errors.length);
  check("no console error on any seat from install to the end of the walk", drains.every((n) => n === 0), { perSeat: drains });
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
  for (const [label, seat] of [["gm", gm], ["player A", playerA], ["player B", playerB]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixtures kept: ${Object.values(MARKERS).join(", ")}`);
  for (const seat of [playerB, playerA, gm]) { try { if (seat) await seat.close(); } catch {} }
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`checks: ${passed} passed, ${checks.length - passed} failed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
