/**
 * Live walk: docs/formation/TESTING.md "The party's form, movement and Order on a
 * Player seat" (T-0792 B3). A real Player seat that owns a party member is drawn
 * and uses the band's mode select and name, the city's pickers, the journey's
 * movement tiles, flight, Sky with Roll weather, the Day section and Camp, the
 * Order tab's head and a blank's controls, Load order and the Skill audit opener;
 * a seat that owns a RollTable is drawn its Monster level row; every seat reads
 * the strip's city progress. The Judge's seat reads each write back.
 *
 * Steps report under the recipe's ids: S1a to S1b (the band), S4a to S4d (the
 * city), S6a to S6c (the movement), S7a to S7g (flight, Sky, Day, Camp and the
 * barred forced march), S8a to S8g (the Order tab), S17a to S17b (the RollTable)
 * and S19 (the strip). A step the world cannot give is printed as `NOT WALKED
 * <id> <reason>`, which is neither a PASS nor a FAIL.
 *
 * The walk changes no world permission: a default Player lacks Configure
 * Settings, which is the case under test. Where the Player seat holds it, the
 * steps that need it absent print NOT WALKED.
 *
 * Scripted, not gestured: every press is a real click on the seat's own open
 * sheet and every field a value typed the way a person leaves a field (input,
 * then change). The Skill audit and the Load order dialog are found by the
 * window id and the dialog's own markup.
 *
 * Every name is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): the journey party's `formation/heads-journey-*`, the city
 * party's `formation/heads-city-*`, the Order party's `formation/kit-seat-*`
 * with an ability Item on each member (`formation/forms-ability-a` and `-b`),
 * and two RollTables, `formation/rolegate-table` and `formation/rolegate-table-seen`.
 * Deletes by the run's own ledger only: the cards the presses post, tracked by id.
 * The one world-wide entry the walk writes, a saved marching order, is forgotten
 * by the id its own save returned.
 *
 * Seats: the primary GM and a Player user (SEAT_PLAYER). The Judge's seat runs
 * every relay.
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__sfBoot = { phase: "load", phases: [], errors: [] });
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
/*  A function closes over nothing but its argument and __sf.          */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    user: game.user.name,
    userId: game.user.id,
    role: game.user.role,
    settings: !!game.user.can("SETTINGS_MODIFY"),
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    boot: globalThis.__sfBoot ?? null,
  }),

  /** Import the modules the walk reads, add helpers, and record every notification the seat is shown. */
  install: async () => {
    const H = (globalThis.__sf = globalThis.__sf ?? {});
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
    H.partyForm = await import(`${base}formation/party-form.mjs`);
    H.audit = await import(`${base}formation/skill-audit.mjs`);
    H.orders = await import(`${base}formation/marching-templates.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.set = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (!H.notes) {
      H.notes = [];
      for (const level of ["info", "warn", "error"]) {
        const original = ui.notifications[level].bind(ui.notifications);
        ui.notifications[level] = (message, options) => { H.notes.push({ level, text: String(message) }); return original(message, options); };
      }
    }
    return { ok: typeof H.requests.requestPartyForm === "function" && typeof H.partyForm.applyPartyForm === "function" };
  },

  /** The notifications recorded so far, cleared. */
  notes: async () => globalThis.__sf.notes.splice(0, globalThis.__sf.notes.length),
  nowMs: async () => Date.now(),
  boot: async () => globalThis.__sfBoot ?? null,
  loc: async ({ key, data = null }) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),

  formationOf: async ({ partyId }) => {
    const H = globalThis.__sf;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  tokenData: async ({ actorId, xy }) => ({ ...(await game.actors.get(actorId).getTokenDocument({ x: xy.x, y: xy.y })).toObject() }),

  /**
   * A party brought to its start shape: members in order (added with no token), the seat owning `owned` and none of
   * the others, careful pace, no blank cell, the mode, and for a journey a fresh march day shown `believed`.
   */
  shape: async ({ fid, members, owned = [], seatId, mode, sceneId = null, tokenAt = null }) => {
    const H = globalThis.__sf;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const order = () => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    for (const id of members) {
      if (!H.model.getFormation(fid).members.some((m) => m?.actorId === id)) await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), null, { scene: null });
    }
    await H.model.patchFormation(fid, (rec) => { rec.members = members.map((id) => rec.members.find((m) => m?.actorId === id)).filter(Boolean); });
    for (const id of members) {
      await game.actors.get(id).update({ ownership: owned.includes(id) ? { default: 0, [seatId]: 3 } : { default: 0 } }, { diff: false, recursive: false });
    }
    await H.model.setHurried(fid, false);
    if (tokenAt) {
      const tok = H.model.getPartyToken(H.model.getFormation(fid));
      if (tok && (tok._source.x !== tokenAt.x || tok._source.y !== tokenAt.y)) await tok.update({ x: tokenAt.x, y: tokenAt.y }, { animate: false, "acks-extras.poiTravel": true });
    }
    if (H.travel.travelOf(H.model.getFormation(fid)).mode !== mode || mode === "settlement") await H.travel.setJourneyMode(fid, mode, { sceneId });
    if (mode === "journey") {
      await H.travel.applyTravelForm(fid, { shown: "believed" });
      await H.model.patchFormation(fid, (rec) => {
        const t = H.travel.storedTravelOf(rec);
        rec.travel = { ...t, day: H.travel.freshDay("march") };
      });
    }
    if (mode === "settlement") await H.travel.patchSettlement(fid, { wanted: false, blocks: 0, turns: 0, lost: false });
    await H.sleep(700);
    return { order: order(), mode: H.travel.travelOf(H.model.getFormation(fid)).mode, same: same(order(), members) };
  },

  /** What the record holds, as the Judge's client reads it. */
  record: async ({ fid }) => {
    const H = globalThis.__sf;
    const f = H.model.getFormation(fid);
    const t = H.travel.storedTravelOf(f);
    return {
      name: f.name,
      actorName: game.actors.get(f.actorId)?.name ?? null,
      mode: H.travel.travelOf(f).mode,
      frontage: H.model.getFrontage(f),
      tokenShape: f.tokenShape ?? "",
      cells: (f.members ?? []).map((m) => (m?.blank ? "blank" : m?.actorId ?? null)),
      movementSet: t.movement?.set ?? null,
      hoursAloft: t.movement?.hoursAloft ?? null,
      precipitation: t.weather?.precipitation ?? null,
      temperature: t.weather?.temperature ?? null,
      rolls: JSON.stringify(t.weather?.rolls ?? null),
      dayKind: t.day?.kind ?? null,
      activities: t.day?.activities ?? [],
      campWater: t.camp?.water ?? null,
      pace: t.settlement?.pace ?? null,
      route: t.settlement?.route ?? null,
      wanted: !!t.settlement?.wanted,
      blocks: t.settlement?.blocks ?? null,
      turns: t.settlement?.turns ?? null,
      judgeKeys: JSON.stringify({ shown: t.shown ?? null, lostNote: t.lostNote ?? t.lost?.note ?? null, override: t.override ?? null, present: t.camp?.present ?? null, tableId: f.tableId ?? null }),
    };
  },

  /** Put a party back in a mode: a journeying or settled record is billed on every clock advance. */
  setMode: async ({ fid, mode }) => {
    await globalThis.__sf.travel.setJourneyMode(fid, mode, { sceneId: null });
    return { mode };
  },

  /** The Judge's own writes the walk uses to set a start shape or a state to read. */
  settle: async ({ fid, what, value = null }) => {
    const H = globalThis.__sf;
    if (what === "wanted") await H.travel.patchSettlement(fid, { wanted: !!value });
    if (what === "progress") await H.travel.patchSettlement(fid, value);
    if (what === "clearWord") {
      await H.model.patchFormation(fid, (rec) => {
        const t = H.travel.storedTravelOf(rec);
        const movement = { ...(t.movement ?? {}) };
        delete movement.set;
        rec.travel = { ...t, movement };
      });
    }
    if (what === "reverse") await H.model.patchFormation(fid, (rec) => { rec.members = [...rec.members].reverse(); });
    if (what === "noBlanks") await H.model.patchFormation(fid, (rec) => { rec.members = rec.members.filter((m) => !m?.blank); });
    if (what === "restore") await H.partyForm.applyPartyForm(H.model.getFormation(fid), value, { judge: true });
    await H.sleep(600);
    return { ok: true };
  },

  /** A member's survival flag written whole (a barring rung), or removed with a null value. */
  survival: async ({ actorId, value }) => {
    const actor = game.actors.get(actorId);
    await actor.unsetFlag("acks-extras", "survival");
    if (value) await actor.setFlag("acks-extras", "survival", value);
    return { ok: true };
  },

  /** Save the formation's arrangement under a name through the API; the id its own save returned. */
  orderSave: async ({ fid, name }) => {
    const H = globalThis.__sf;
    const out = await H.orders.saveTemplate(H.model.getFormation(fid), name);
    return { id: out?.template?.id ?? null };
  },
  orderForget: async ({ id }) => ({ gone: await globalThis.__sf.orders.deleteTemplate(id) }),

  cards: async ({ since }) => game.messages.contents
    .filter((m) => m.timestamp >= since)
    .map((m) => ({
      id: m.id,
      alias: m.speaker?.alias ?? "",
      text: (m.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      whispered: (m.whisper ?? []).length > 0,
    })),

  /** Open a party sheet on this seat at a tab. */
  open: async ({ partyId, tab = "mode", width = 920, height = 820 }) => {
    const H = globalThis.__sf;
    const actor = game.actors.get(partyId);
    // The seat's ownership of the party arrives with the Judge's write; a sheet asked for before it lands does not draw.
    await H.poll(() => actor.isOwner, { tries: 60, every: 200 });
    const app = actor.sheet;
    await app.render(true);
    const root = await H.poll(() => H.root(app), { tries: 60, every: 200 });
    if (!root) return { id: app.id, rendered: false, isOwner: !!actor.isOwner };
    await H.sleep(1000);
    app.setPosition({ left: 16, top: 16, width, height });
    H.root(app)?.querySelector(`.tabs [data-group="primary"][data-tab="${tab}"]`)?.click();
    await H.sleep(700);
    return { id: app.id };
  },

  close: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** The sheet's own context: what the city section is drawn for, and the seat object. */
  ctx: async ({ partyId }) => {
    const H = globalThis.__sf;
    const app = game.actors.get(partyId).sheet;
    await app.render();
    await H.sleep(600);
    const c = await app._prepareContext({});
    return {
      shown: !!c.travel?.settlement?.shown,
      districtName: c.travel?.settlement?.districtName ?? "",
      placeHere: !!c.travel?.settlement?.placeHere,
      districtPlace: !!c.travel?.settlement?.districtPlace,
      seat: c.seat ?? null,
    };
  },

  /** Counts, text and disabled flags for named selectors in the open sheet. */
  query: async ({ partyId, sels }) => {
    const H = globalThis.__sf;
    const el = H.root(game.actors.get(partyId).sheet);
    return Object.fromEntries(Object.entries(sels).map(([key, sel]) => {
      const found = [...(el?.querySelectorAll(sel) ?? [])];
      return [key, { n: found.length, text: found[0]?.textContent.replace(/\s+/g, " ").trim() ?? "", disabled: found.map((b) => !!b.disabled), mode: found.map((b) => b.dataset?.mode ?? null), pressed: found.map((b) => b.getAttribute("aria-pressed")) }];
    }));
  },

  /** A field of the open sheet: its value, its options and whether it is disabled; or every field whose name starts with `prefix`. */
  field: async ({ partyId, name = null, prefix = null }) => {
    const H = globalThis.__sf;
    const el = H.root(game.actors.get(partyId).sheet);
    const read = (c) => ({ name: c.getAttribute("name"), value: c.type === "checkbox" ? !!c.checked : c.value, disabled: !!c.disabled, max: c.max ?? "", options: [...(c.options ?? [])].map((o) => o.value) });
    if (prefix) return { fields: [...(el?.querySelectorAll(`[name^="${prefix}"]`) ?? [])].map(read) };
    const c = el?.querySelector(`[name="${name}"]`);
    return c ? { found: true, ...read(c) } : { found: false };
  },

  /** A form field typed into as a person does: the value, `input`, then `change`. */
  type: async ({ partyId, name, value, settle = 2200 }) => {
    const H = globalThis.__sf;
    const c = H.root(game.actors.get(partyId).sheet)?.querySelector(`[name="${name}"]`);
    if (!c) return { found: false };
    H.notes.length = 0;
    H.set(c, value);
    await H.sleep(settle);
    return { found: true };
  },

  /** A checkbox toggled as a person does. */
  toggle: async ({ partyId, name, settle = 2200 }) => {
    const H = globalThis.__sf;
    const c = H.root(game.actors.get(partyId).sheet)?.querySelector(`input[type="checkbox"][name="${name}"]`);
    if (!c) return { found: false };
    c.checked = !c.checked;
    c.dispatchEvent(new Event("input", { bubbles: true }));
    c.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(settle);
    return { found: true };
  },

  /** A real click on a control of the open sheet. */
  click: async ({ partyId, selector, settle = 2000 }) => {
    const H = globalThis.__sf;
    const control = H.root(game.actors.get(partyId).sheet)?.querySelector(selector);
    if (!control) return { found: false, selector };
    const disabled = !!control.disabled;
    H.notes.length = 0;
    control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },

  /** Every standing dialog's buttons; with `action`, that button pressed. With `pick`, the dialog's select is set first. */
  dialog: async ({ action = null, pick = null, tries = 30 }) => {
    const H = globalThis.__sf;
    const open = () => [...document.querySelectorAll("dialog.dialog, .application.dialog")].filter((d) => d.classList.contains("acks-extras-scroll") && d.querySelector("button[data-action]"));
    const dlg = await H.poll(() => open()[0], { tries, every: 150 });
    if (!dlg) return { dialog: false };
    const buttons = [...dlg.querySelectorAll("button[data-action]")].map((b) => b.dataset.action);
    const select = dlg.querySelector('select[name="id"]');
    const options = [...(select?.options ?? [])].map((o) => o.value);
    if (select && pick) select.value = pick;
    if (action) {
      dlg.querySelector(`button[data-action="${action}"]`)?.click();
      await H.sleep(2500);
    }
    return { dialog: true, buttons, options };
  },

  /** The blank cell's own controls on the open Order tab: its cell index and which move buttons are enabled. */
  blank: async ({ partyId }) => {
    const H = globalThis.__sf;
    const li = H.root(game.actors.get(partyId).sheet)?.querySelector("li.blank-cell");
    if (!li) return { found: false };
    const enabled = ["memberUp", "memberLeft", "memberRight", "memberDown"].filter((a) => { const b = li.querySelector(`[data-action="${a}"]`); return b && !b.disabled; });
    return { found: true, cell: li.dataset.cellIndex, enabled, remove: !!li.querySelector('[data-action="removeBlank"]') };
  },

  /** The audit window for a party as this seat holds it: each Used-for select with whether it is disabled and whether the seat owns its item. */
  auditRead: async ({ fid }) => {
    const H = globalThis.__sf;
    const el = await H.poll(() => document.getElementById(H.audit.auditWindowId(fid)), { tries: 40, every: 200 });
    if (!el) return { open: false };
    return {
      open: true,
      selects: [...el.querySelectorAll('select[data-field="checkKey"][data-item-uuid]')].map((s) => ({ uuid: s.dataset.itemUuid, disabled: !!s.disabled, owner: !!fromUuidSync(s.dataset.itemUuid)?.isOwner })),
    };
  },
  auditClose: async ({ fid }) => {
    const H = globalThis.__sf;
    try { await foundry.applications.instances.get(H.audit.auditWindowId(fid))?.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** A crafted `partyForm` request from this seat's page, which the Judge's client picks again. */
  craft: async ({ fid, form }) => globalThis.__sf.requests.requestPartyAction(fid, "partyForm", { form }, { sent: false }),

  own: async ({ uuid, ownership }) => {
    await (await fromUuid(uuid)).update({ ownership }, { diff: false, recursive: false });
    return { ok: true };
  },

  /** A RollTable's sheet on this seat: whether it is editable and in edit mode, and whether the level row is drawn. */
  tableOpen: async ({ uuid }) => {
    const H = globalThis.__sf;
    const table = await fromUuid(uuid);
    const app = table.sheet;
    try { await app.close({ animate: false }); } catch (_e) { /* closed */ }
    await app.render({ force: true });
    await H.sleep(1200);
    if (app.isEditable && !app.isEditMode) { app.mode = "edit"; await app.render(); await H.sleep(800); }
    const el = H.root(app);
    return { editable: !!app.isEditable, edit: !!app.isEditMode, row: !!el?.querySelector(".acks-extras-monster-level input") };
  },
  /** Type a level into the row and press the sheet's own Save. */
  tableSave: async ({ uuid, level }) => {
    const H = globalThis.__sf;
    const app = (await fromUuid(uuid)).sheet;
    const el = H.root(app);
    const input = el?.querySelector(".acks-extras-monster-level input");
    if (!input) return { found: false };
    input.value = String(level);
    const save = el.querySelector('button[type="submit"]');
    if (save) save.click(); else app.form?.requestSubmit();
    await H.sleep(1500);
    return { found: true };
  },
  tableClose: async ({ uuid }) => {
    try { await (await fromUuid(uuid)).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },
  level: async ({ uuid }) => fromUuidSync(uuid)?.getFlag("acks-extras", "monsterLevel") ?? null,
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
const held = { partyIds: [], savedOrder: null, auditFid: null, journeyFid: null, modeParties: [], tables: [], barred: null, restore: [] };
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
  note("seat", { role: census.seat.role, settings: census.seat.settings });
  if (census.seat.role !== 1) blocked(`the seat's role is ${census.seat.role}; the walk is for a Player (1) seat`);
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the relay would run there");
  check("the Judge's seat is a GM, the active one, and the other seat a Player", census.gm.role >= 3, { gm: census.gm.role, seat: census.seat.role });
  for (const [key, c] of Object.entries(census)) check(`${key}: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  const seatId = census.seat.userId;
  const seatSettings = census.seat.settings;
  const yours = { default: 0, [seatId]: 3 };
  const L = async (key, data) => run(gm, P.loc, { key, data });

  /* ------------------------------ fixtures ------------------------------ */
  section("fixtures");
  const journey = {
    scene: await gm.fixture("formation/heads-journey-scene", "Scene", { name: "QA Heads Journey Scene", width: 2000, height: 1500, grid: { type: 2, size: 100 }, ownership: { default: 2 } }),
    party: await gm.fixture("formation/heads-journey-party", "Actor", { name: "QA Heads Journey Party", type: `${SCOPE}.party` }),
    member: await gm.fixture("formation/heads-journey-member", "Actor", character("QA Heads Journey Member", yours)),
  };
  const city = {
    scene: await gm.fixture("formation/heads-city-scene", "Scene", { name: "QA Heads City Scene", width: 1600, height: 1000, grid: { size: 100 }, ownership: { default: 2 } }),
    party: await gm.fixture("formation/heads-city-party", "Actor", { name: "QA Heads City Party", type: `${SCOPE}.party` }),
    member: await gm.fixture("formation/heads-city-member", "Actor", character("QA Heads City Member", yours)),
  };
  const order = {
    party: await gm.fixture("formation/kit-seat-party", "Actor", { name: "QA Kit Seat Party", type: `${SCOPE}.party` }),
    a: await gm.fixture("formation/kit-seat-a", "Actor", character("QA Kit Seat A", yours)),
    b: await gm.fixture("formation/kit-seat-b", "Actor", character("QA Kit Seat B")),
  };
  const ability = { type: "ability", system: { roll: "1d20", rollType: "above", rollTarget: 13 } };
  await gm.fixture("formation/forms-ability-a", "Item", { name: "QA Forms Ability A", ...ability }, { parent: `Actor.${order.a.id}` });
  await gm.fixture("formation/forms-ability-b", "Item", { name: "QA Forms Ability B", ...ability }, { parent: `Actor.${order.b.id}` });
  await gm.fixture("formation/heads-journey-token", "Token", await run(gm, P.tokenData, { actorId: journey.party.id, xy: { x: 500, y: 500 } }), { parent: journey.scene.uuid });
  await gm.fixture("formation/heads-city-token", "Token", await run(gm, P.tokenData, { actorId: city.party.id, xy: { x: 200, y: 200 } }), { parent: city.scene.uuid });
  const tables = {
    owned: await gm.fixture("formation/rolegate-table", "RollTable", { name: "QA Rolegate Table", formula: "1d2" }),
    seen: await gm.fixture("formation/rolegate-table-seen", "RollTable", { name: "QA Rolegate Table Seen", formula: "1d2" }),
  };
  held.tables = [tables.owned.uuid, tables.seen.uuid];
  held.partyIds = [journey.party.id, city.party.id, order.party.id];

  const fids = {};
  for (const [key, party] of Object.entries({ journey: journey.party, city: city.party, order: order.party })) {
    const f = await run(gm, P.formationOf, { partyId: party.id });
    if (f.error) throw new Error(`${key}: ${f.error}`);
    fids[key] = f.fid;
  }
  held.journeyFid = fids.journey;
  held.modeParties = [fids.journey, fids.city];
  note("fixtures", { journey: journey.party.uuid, city: city.party.uuid, order: order.party.uuid, tables: held.tables });

  const since = await run(gm, P.nowMs);
  const cardsSince = async (t, filter = () => true) => (await run(gm, P.cards, { since: t })).filter(filter);
  const shapeJourney = () => run(gm, P.shape, { fid: fids.journey, members: [journey.member.id], owned: [journey.member.id], seatId, mode: "journey", sceneId: journey.scene.id });
  const shapeCity = () => run(gm, P.shape, { fid: fids.city, members: [city.member.id], owned: [city.member.id], seatId, mode: "settlement", sceneId: city.scene.id, tokenAt: { x: 200, y: 200 } });
  const shapeOrder = async () => {
    const s = await run(gm, P.shape, { fid: fids.order, members: [order.a.id, order.b.id], owned: [order.a.id], seatId, mode: "delve" });
    await run(gm, P.settle, { fid: fids.order, what: "noBlanks" });
    return s;
  };
  const press = (api, partyId, selector, settle) => run(api, P.click, { partyId, selector, settle });
  const warned = (notes, text) => notes.some((n) => n.level === "warn" && n.text === text);
  const diffFrom = (options, current) => options.find((o) => o !== current && o !== "") ?? null;

  // What the run found, put back in the finally.
  const found = {
    journey: await run(gm, P.record, { fid: fids.journey }),
    city: await run(gm, P.record, { fid: fids.city }),
    order: await run(gm, P.record, { fid: fids.order }),
  };
  held.restore = [
    { fid: fids.journey, name: found.journey.name },
    { fid: fids.city, name: found.city.name },
    { fid: fids.order, name: found.order.name, frontage: found.order.frontage, tokenShape: found.order.tokenShape },
  ];

  /* ------------------------------- S1 ------------------------------- */
  section("S1. The band");
  const s1 = await shapeJourney();
  check("S1 start shape: one member, the party in journey mode", s1.mode === "journey" && s1.same, s1);
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const band = await run(player, P.field, { partyId: journey.party.id, name: "travel.mode" });
  const bandName = await run(player, P.field, { partyId: journey.party.id, name: "name" });
  check("S1a the band draws the mode select and S1b the name field on the Player seat", band.found && !band.disabled && bandName.found && !bandName.disabled, { mode: band.found, name: bandName.found });
  const otherMode = diffFrom(band.options ?? [], "journey");
  if (!otherMode) notWalked("S1a", "the mode select offers no second mode");
  else {
    await run(player, P.type, { partyId: journey.party.id, name: "travel.mode", value: otherMode });
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => x.mode === otherMode);
    check("S1a the Player's mode pick lands on the record, read on the Judge's seat", r.mode === otherMode, { picked: otherMode, mode: r.mode });
  }
  await shapeJourney();
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const typed = "QA Forms Renamed";
  await run(player, P.type, { partyId: journey.party.id, name: "name", value: typed });
  const renamed = await until(gm, P.record, { fid: fids.journey }, (x) => x.name === typed);
  check("S1b the Player's name lands on the record and on the party actor", renamed.name === typed && renamed.actorName === typed, { name: renamed.name, actor: renamed.actorName });
  await run(gm, P.settle, { fid: fids.journey, what: "restore", value: { name: found.journey.name } });

  /* ------------------------------- S4 ------------------------------- */
  section("S4. The city");
  const s4 = await shapeCity();
  check("S4 start shape: one member, the party in the city", s4.mode === "settlement" && s4.same, s4);
  await run(player, P.open, { partyId: city.party.id, tab: "mode" });
  const cctx = await run(player, P.ctx, { partyId: city.party.id });
  check("S4a The city section is drawn with no district and no place underfoot", cctx.shown && !cctx.districtName && !cctx.placeHere && !cctx.districtPlace && cctx.seat?.ownsMember === true && cctx.seat?.isGM === false, cctx);
  await run(gm, P.settle, { fid: fids.city, what: "wanted", value: true });
  await run(player, P.open, { partyId: city.party.id, tab: "mode" });
  const pace = await run(player, P.field, { partyId: city.party.id, name: "travel.settlement.pace" });
  const route = await run(player, P.field, { partyId: city.party.id, name: "travel.settlement.route" });
  const newPace = diffFrom(pace.options ?? [], pace.value);
  const newRoute = diffFrom(route.options ?? [], route.value);
  if (!pace.found || !newPace || !route.found || !newRoute) notWalked("S4b", `the pickers offer no second value (pace ${pace.found}, route ${route.found})`);
  else {
    await run(player, P.type, { partyId: city.party.id, name: "travel.settlement.pace", value: newPace });
    await run(player, P.open, { partyId: city.party.id, tab: "mode" });
    await run(player, P.type, { partyId: city.party.id, name: "travel.settlement.route", value: newRoute });
    const r = await until(gm, P.record, { fid: fids.city }, (x) => x.pace === newPace && x.route === newRoute);
    check("S4b pace and route land on the record and the board is still wanted", r.pace === newPace && r.route === newRoute && r.wanted === true, { pace: r.pace, route: r.route, wanted: r.wanted });
  }
  await run(player, P.open, { partyId: city.party.id, tab: "mode" });
  const q4 = await run(player, P.query, { partyId: city.party.id, sels: { box: 'input[name="travel.settlement.wanted"]', hunter: ".acks-extras-formation-settlement-hunter" } });
  await run(gm, P.open, { partyId: city.party.id, tab: "mode" });
  const g4 = await run(gm, P.query, { partyId: city.party.id, sels: { box: 'input[name="travel.settlement.wanted"]' } });
  check("S4c no Hunted here box and no hunter line on the Player's seat, and the Judge's seat draws the box", q4.box.n === 0 && q4.hunter.n === 0 && g4.box.n === 1, { player: [q4.box.n, q4.hunter.n], gm: g4.box.n });
  await run(gm, P.close, { partyId: city.party.id });
  const before4 = await run(gm, P.record, { fid: fids.city });
  const crafted = await run(player, P.craft, { fid: fids.city, form: { name: "QA Forms City Name", tableId: "x", travel: { shown: "unknown", lostNote: "QA note", override: { ground: "x" }, camp: { present: "x" }, settlement: { wanted: false } } } });
  const after4 = await until(gm, P.record, { fid: fids.city }, (x) => x.name === "QA Forms City Name");
  check("S4d a crafted form carrying the Judge's keys lands the allowed name and changes none of them", crafted?.ok !== false && after4.name === "QA Forms City Name" && after4.judgeKeys === before4.judgeKeys && after4.wanted === true, { answer: crafted, same: after4.judgeKeys === before4.judgeKeys, wanted: after4.wanted });
  await run(gm, P.settle, { fid: fids.city, what: "restore", value: { name: found.city.name } });

  /* ------------------------------- S19 ------------------------------- */
  section("S19. The strip's city progress");
  await run(gm, P.settle, { fid: fids.city, what: "progress", value: { blocks: 7, turns: 4, lost: true } });
  await run(player, P.open, { partyId: city.party.id, tab: "mode" });
  const q19 = await run(player, P.query, { partyId: city.party.id, sels: { progress: ".acks-extras-formation-settlement-progress", astray: ".acks-extras-formation-settlement-astray" } });
  check("S19 the Player's strip shows the blocks and the turns and the turned-around warning", q19.progress.n === 1 && /7/.test(q19.progress.text) && /4/.test(q19.progress.text) && q19.astray.n === 1, q19);
  await run(gm, P.settle, { fid: fids.city, what: "progress", value: { blocks: 0, turns: 0, lost: false } });
  await run(player, P.close, { partyId: city.party.id });

  /* ------------------------------- S6 and S7 ------------------------------- */
  section("S6 and S7. The journey");
  await shapeJourney();
  await run(gm, P.settle, { fid: fids.journey, what: "clearWord" });
  const j0 = await run(gm, P.record, { fid: fids.journey });
  check("S6 start shape: no movement word", j0.movementSet === null, j0.movementSet);
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const tiles = await run(player, P.query, { partyId: journey.party.id, sels: { tile: 'button[data-action="movementTile"]' } });
  const tileMode = tiles.tile.mode.includes("flying") ? "flying" : tiles.tile.mode.find((m, i) => m && !tiles.tile.disabled[i]) ?? null;
  if (!tileMode) notWalked("S6a", `no enabled movement tile on the Player's seat (${tiles.tile.n} drawn)`);
  else {
    check("S6a the tiles are drawn enabled on the Player's seat", tiles.tile.disabled.every((d) => d === false), tiles.tile);
    await press(player, journey.party.id, `button[data-action="movementTile"][data-mode="${tileMode}"]`);
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => x.movementSet !== null);
    check("S6a a tile press sets the group's word, read on the Judge's seat", r.movementSet === tileMode, { tile: tileMode, set: r.movementSet });
  }
  const flight = await run(player, P.field, { partyId: journey.party.id, name: "travel.movement.hoursAloft" });
  if (!flight.found) notWalked("S7a", "no flight field drawn (the tile chosen does not make the party fly)");
  else {
    await run(player, P.type, { partyId: journey.party.id, name: "travel.movement.hoursAloft", value: "7" });
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => Number(x.hoursAloft) === 7);
    check("S7a a flight field written on the Player's seat lands on the record", Number(r.hoursAloft) === 7, { hoursAloft: r.hoursAloft });
  }
  const back = await run(player, P.query, { partyId: journey.party.id, sels: { auto: '[data-section="movement"] [data-action="movementFastest"]', undo: '[data-action="movementUndo"]' } });
  if (!back.auto.n) notWalked("S6b", "Back to automatic is not drawn");
  else {
    await press(player, journey.party.id, '[data-section="movement"] [data-action="movementFastest"]');
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => x.movementSet === null);
    check("S6b Back to automatic clears the word", r.movementSet === null, { set: r.movementSet });
  }
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const undo = await run(player, P.query, { partyId: journey.party.id, sels: { undo: '[data-action="movementUndo"]' } });
  if (!undo.undo.n) notWalked("S6c", "no arrangement snapshot exists, so no Undo is drawn (a tile that moves nobody takes none; it needs a member on a carrier)");
  else {
    await press(player, journey.party.id, '[data-action="movementUndo"]');
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => x.movementSet !== null);
    check("S6c Undo puts back the word the last pass found", r.movementSet === tileMode, { set: r.movementSet });
  }
  await run(gm, P.settle, { fid: fids.journey, what: "clearWord" });

  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const precip = await run(player, P.field, { partyId: journey.party.id, name: "travel.weather.precipitation" });
  const newPrecip = diffFrom(precip.options ?? [], precip.value);
  if (!precip.found || !newPrecip) notWalked("S7b", "no Sky precipitation field with a second value");
  else {
    await run(player, P.type, { partyId: journey.party.id, name: "travel.weather.precipitation", value: newPrecip });
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => x.precipitation === newPrecip);
    check("S7b a Sky field written on the Player's seat lands on the record", r.precipitation === newPrecip, { precipitation: r.precipitation });
  }
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const roll = await run(player, P.query, { partyId: journey.party.id, sels: { roll: '[data-action="travelWeatherRoll"]' } });
  const journeyName = (await run(gm, P.record, { fid: fids.journey })).name;
  if (!roll.roll.n || roll.roll.disabled[0]) notWalked("S7c", `Roll weather is ${roll.roll.n ? "disabled (no imported sky tables)" : "not drawn"}`);
  else {
    let t = await run(gm, P.nowMs);
    await press(player, journey.party.id, '[data-action="travelWeatherRoll"]', 3000);
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => x.temperature !== null);
    const lines = await cardsSince(t, (c) => c.alias === journeyName && !c.whispered);
    check("S7c Roll weather from the Player's seat writes the sky and announces the press once", r.temperature !== null && lines.length === 1, { temperature: r.temperature, lines: lines.length });
    await run(gm, P.open, { partyId: journey.party.id, tab: "mode" });
    t = await run(gm, P.nowMs);
    await press(gm, journey.party.id, '[data-action="travelWeatherRoll"]', 3000);
    check("S7c the Judge's own press posts no line", (await cardsSince(t, (c) => c.alias === journeyName)).length === 0);
    await run(gm, P.close, { partyId: journey.party.id });
  }
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const slots = (await run(player, P.field, { partyId: journey.party.id, prefix: "travel.day.slot." })).fields;
  const slot = slots.find((s) => !s.disabled && diffFrom(s.options, s.value));
  if (!slot) notWalked("S7d", `no enabled day slot with a second value (${slots.length} drawn)`);
  else {
    const index = Number(slot.name.split(".").pop());
    const pick = diffFrom(slot.options, slot.value);
    await run(player, P.type, { partyId: journey.party.id, name: slot.name, value: pick });
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => (x.activities[index] ?? "") === pick);
    check("S7d a day slot picked on the Player's seat lands on the record", (r.activities[index] ?? "") === pick, { slot: index, activities: r.activities });
  }
  await run(player, P.open, { partyId: journey.party.id, tab: "mode" });
  const camp0 = await run(gm, P.record, { fid: fids.journey });
  const campBox = await run(player, P.field, { partyId: journey.party.id, name: "travel.camp.water" });
  if (!campBox.found) notWalked("S7e", "no camp declaration drawn");
  else {
    await run(player, P.toggle, { partyId: journey.party.id, name: "travel.camp.water" });
    const r = await until(gm, P.record, { fid: fids.journey }, (x) => !!x.campWater !== !!camp0.campWater);
    check("S7e a camp declaration ticked on the Player's seat lands on the record", !!r.campWater !== !!camp0.campWater, { before: camp0.campWater, after: r.campWater });
    await run(player, P.toggle, { partyId: journey.party.id, name: "travel.camp.water" });
  }

  section("S7f and S7g. A forced march into a barred party");
  const kind0 = (await run(gm, P.record, { fid: fids.journey })).dayKind;
  const kindField = await run(player, P.field, { partyId: journey.party.id, name: "travel.day.kind" });
  if (!kindField.found || !kindField.options.includes("forced")) notWalked("S7f", "the day kind select offers no forced march");
  else {
    held.barred = journey.member.id;
    await run(gm, P.survival, { actorId: journey.member.id, value: { nourishment: "underfed" } });
    const memberName = (await fetchName(gm, journey.member.id));
    await run(player, P.type, { partyId: journey.party.id, name: "travel.day.kind", value: "forced" });
    const notes = await run(player, P.notes);
    const said = await L("ACKS-FORMATION.warn.forcedMarchBarred", { names: memberName });
    const dlgOnSeat = await run(player, P.dialog, { action: null, tries: 3 });
    const r = await run(gm, P.record, { fid: fids.journey });
    check("S7f the Player's seat is refused with the barred member named, nothing is written and no dialog opens there", warned(notes, said) && r.dayKind === kind0 && !dlgOnSeat.dialog, { notes, kind: [kind0, r.dayKind], dialog: dlgOnSeat.dialog });
    await run(gm, P.open, { partyId: journey.party.id, tab: "mode" });
    await run(gm, P.type, { partyId: journey.party.id, name: "travel.day.kind", value: "forced", settle: 800 });
    const asked = await run(gm, P.dialog, { action: null });
    check("S7g the Judge's seat is asked whether to set the barred march anyway", asked.dialog && asked.buttons.includes("no") && asked.buttons.includes("yes"), asked);
    if (asked.dialog) await run(gm, P.dialog, { action: "no" });
    const r2 = await run(gm, P.record, { fid: fids.journey });
    check("S7g answering Leave the day as it is leaves the kind unchanged", r2.dayKind === kind0, { kind: [kind0, r2.dayKind] });
    await run(gm, P.survival, { actorId: journey.member.id, value: null });
    held.barred = null;
    await run(gm, P.close, { partyId: journey.party.id });
  }
  await run(player, P.close, { partyId: journey.party.id });

  /* ------------------------------- S8 ------------------------------- */
  section("S8. The Order tab");
  const s8 = await shapeOrder();
  check("S8 start shape: A owned then B, in delve, no blank", s8.mode === "delve" && s8.same, s8);
  const cells0 = (await run(gm, P.record, { fid: fids.order })).cells;
  await run(player, P.open, { partyId: order.party.id, tab: "order" });
  await press(player, order.party.id, '[data-action="autoArrange"]');
  const notes8a = await run(player, P.notes);
  const r8a = await run(gm, P.record, { fid: fids.order });
  check("S8a Auto-arrange from the Player's seat is taken: no refusal, both members still stand", !notes8a.some((n) => n.level === "warn") && [order.a.id, order.b.id].every((id) => r8a.cells.includes(id)), { before: cells0, after: r8a.cells, notes: notes8a });
  await run(gm, P.settle, { fid: fids.order, what: "noBlanks" });
  await run(player, P.open, { partyId: order.party.id, tab: "order" });
  await press(player, order.party.id, '[data-action="addBlank"]');
  const r8b1 = await until(gm, P.record, { fid: fids.order }, (x) => x.cells.includes("blank"));
  await run(player, P.open, { partyId: order.party.id, tab: "order" });
  const blank1 = await run(player, P.blank, { partyId: order.party.id });
  const index1 = r8b1.cells.indexOf("blank");
  if (!r8b1.cells.includes("blank") || !blank1.found) notWalked("S8b", "Add a blank wrote no blank cell or the Player's sheet drew none");
  else {
    const act = blank1.enabled[0];
    let moved = null;
    if (act) {
      await press(player, order.party.id, `li.blank-cell [data-action="${act}"]`);
      moved = (await run(gm, P.record, { fid: fids.order })).cells.indexOf("blank");
    }
    await run(player, P.open, { partyId: order.party.id, tab: "order" });
    await press(player, order.party.id, 'li.blank-cell [data-action="removeBlank"]');
    const r8b3 = await until(gm, P.record, { fid: fids.order }, (x) => !x.cells.includes("blank"));
    check("S8b a blank is added, moved and removed from the Player's seat", index1 >= 0 && (act ? moved !== index1 : true) && !r8b3.cells.includes("blank") && !!blank1.remove, { added: index1, moved, move: act ?? "none enabled", gone: !r8b3.cells.includes("blank") });
  }
  await run(player, P.open, { partyId: order.party.id, tab: "order" });
  const fr = await run(player, P.field, { partyId: order.party.id, name: "frontage" });
  const frNow = (await run(gm, P.record, { fid: fids.order })).frontage;
  const frNew = frNow === 1 ? 2 : 1;
  if (!fr.found || (fr.max && Number(fr.max) < frNew)) notWalked("S8c", `no frontage field, or its limit ${fr.max} is under ${frNew}`);
  else {
    await run(player, P.type, { partyId: order.party.id, name: "frontage", value: String(frNew) });
    const r = await until(gm, P.record, { fid: fids.order }, (x) => x.frontage === frNew);
    const invalid = await L("ACKS-FORMATION.warn.frontageInvalid");
    await run(player, P.open, { partyId: order.party.id, tab: "order" });
    await run(player, P.type, { partyId: order.party.id, name: "frontage", value: "0" });
    const notes = await run(player, P.notes);
    const r0 = await run(gm, P.record, { fid: fids.order });
    check("S8c a frontage lands, and a zero is refused with the warning said on the Player's seat and nothing written", r.frontage === frNew && warned(notes, invalid) && r0.frontage === frNew, { frontage: [frNow, r.frontage, r0.frontage], notes });
  }
  await run(player, P.open, { partyId: order.party.id, tab: "order" });
  const shape = await run(player, P.field, { partyId: order.party.id, name: "tokenShape" });
  const newShape = shape.found ? (shape.options ?? []).find((o) => o !== shape.value) ?? null : null;
  if (!newShape) notWalked("S8d", "no token shape select with a second value");
  else {
    await run(player, P.type, { partyId: order.party.id, name: "tokenShape", value: newShape });
    const r = await until(gm, P.record, { fid: fids.order }, (x) => x.tokenShape === newShape);
    check("S8d a token shape picked on the Player's seat lands on the record", r.tokenShape === newShape, { picked: newShape, shape: r.tokenShape });
  }

  await shapeOrder();
  const saved = await run(gm, P.orderSave, { fid: fids.order, name: "QA Forms Order" });
  held.savedOrder = saved.id;
  const savedCells = (await run(gm, P.record, { fid: fids.order })).cells;
  await run(gm, P.settle, { fid: fids.order, what: "reverse" });
  await run(player, P.open, { partyId: order.party.id, tab: "order" });
  await press(player, order.party.id, '[data-action="loadMarchingOrder"]', 600);
  const picked = await run(player, P.dialog, { action: "apply", pick: saved.id });
  const r8e = await until(gm, P.record, { fid: fids.order }, (x) => same(x.cells, savedCells), { tries: 20 });
  check("S8e Load order on the Player's seat forms the party up into the saved order", picked.dialog && same(r8e.cells, savedCells), { cells: r8e.cells, saved: savedCells, dialog: picked.dialog });
  if (seatSettings) notWalked("S8e/S8f (no Forget, no Save order)", "the Player seat holds Configure Settings in this world, so the default Player's absence cannot be shown");
  else check("S8e the load dialog draws no Forget button for a seat without Configure Settings", picked.dialog && !picked.buttons.includes("delete"), picked.buttons);

  await run(player, P.open, { partyId: order.party.id, tab: "order" });
  const head = await run(player, P.query, { partyId: order.party.id, sels: { save: '[data-action="saveMarchingOrder"]', disband: '[data-action="disband"]', add: '[data-action="addBlank"]', load: '[data-action="loadMarchingOrder"]', audit: '[data-action="openSkillAudit"]' } });
  check("S8f the head draws Add a blank, Load order and Skill audit, and no Disband", head.add.n === 1 && head.load.n === 1 && head.audit.n === 1 && head.disband.n === 0, { add: head.add.n, load: head.load.n, audit: head.audit.n, disband: head.disband.n });
  if (!seatSettings) check("S8f the head draws no Save order on a seat without Configure Settings", head.save.n === 0, head.save.n);

  held.auditFid = fids.order;
  await press(player, order.party.id, '[data-action="openSkillAudit"]', 1200);
  const audit = await run(player, P.auditRead, { fid: fids.order });
  const live = (audit.selects ?? []).filter((s) => !s.disabled);
  const dead = (audit.selects ?? []).filter((s) => s.disabled);
  check("S8g the Skill audit opens on the Player's seat with a live Used-for select for each ability it owns and a disabled one for any other", audit.open && live.length >= 1 && dead.length >= 1 && (audit.selects ?? []).every((s) => s.disabled === !s.owner), audit);
  await run(player, P.auditClose, { fid: fids.order });
  await run(player, P.close, { partyId: order.party.id });

  /* ------------------------------- S17 ------------------------------- */
  section("S17. The RollTable's monster level row");
  await run(gm, P.own, { uuid: tables.owned.uuid, ownership: { default: 0, [seatId]: 3 } });
  await run(gm, P.own, { uuid: tables.seen.uuid, ownership: { default: 0, [seatId]: 2 } });
  const t17a = await run(player, P.tableOpen, { uuid: tables.owned.uuid });
  check("S17a the owned table's sheet is editable and draws the Monster level row", t17a.editable && t17a.edit && t17a.row, t17a);
  if (t17a.row) {
    await run(player, P.tableSave, { uuid: tables.owned.uuid, level: 3 });
    const lvl = await until(gm, P.level, { uuid: tables.owned.uuid }, (v) => v === 3);
    check("S17a a level typed and saved through the sheet's own Save lands in the table's flag", lvl === 3, { level: lvl });
  }
  const t17b = await run(player, P.tableOpen, { uuid: tables.seen.uuid });
  check("S17b a table the seat only observes opens read-only and draws no row", !t17b.editable && !t17b.row, t17b);
  for (const uuid of held.tables) await run(player, P.tableClose, { uuid });

  /* ---------------------------- what the table saw ---------------------------- */
  section("what the table saw");
  await sleep(600);
  const aliases = [journey.party.name, city.party.name, order.party.name, found.journey.name, found.city.name, found.order.name, "QA Forms Renamed", "QA Forms City Name"];
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
  // The survival flag, the saved order, the names, the frontage, the shape and the audit window are put back by what the run wrote.
  try { if (open.gm && held.barred) await run(open.gm, P.survival, { actorId: held.barred, value: null }); } catch (err) { console.error("survival:", err?.message ?? err); }
  try { if (open.gm && held.savedOrder) note("saved order forgotten", await run(open.gm, P.orderForget, { id: held.savedOrder })); } catch (err) { console.error("order:", err?.message ?? err); }
  try {
    if (open.gm) for (const r of held.restore) await run(open.gm, P.settle, { fid: r.fid, what: "restore", value: { name: r.name, ...(r.frontage !== undefined ? { frontage: r.frontage, tokenShape: r.tokenShape } : {}) } });
  } catch (err) { console.error("restore:", err?.message ?? err); }
  try { if (open.gm && held.journeyFid) await run(open.gm, P.settle, { fid: held.journeyFid, what: "clearWord" }); } catch (err) { console.error("word:", err?.message ?? err); }
  // A kept party is left in the delve: a journeying or settled record is billed on every clock advance.
  for (const fid of held.modeParties) {
    try { if (open.gm) await run(open.gm, P.setMode, { fid, mode: "delve" }); } catch (err) { console.error("mode:", err?.message ?? err); }
  }
  try { if (open.gm && held.auditFid) await run(open.gm, P.auditClose, { fid: held.auditFid }); } catch (_e) { /* closed */ }
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

/** A world actor's name as a seat reads it. */
async function fetchName(api, actorId) {
  return api.eval(`game.actors.get(${JSON.stringify(actorId)})?.name ?? ""`);
}
