/**
 * Live walk: docs/formation/TESTING.md "The frame on a Player and a Trusted
 * seat" (T-0792 slice 2). The party sheet draws the cells a seat can press, and
 * leaves out the ones it cannot: the walk reads what each rail draws on the
 * seat that runs it, against the list for that seat's role, checks every drawn
 * cell for a tooltip and a name and the Key for exactly the drawn cells, and
 * then presses each newly drawn cell once with a real click: a save card that
 * names only the members the seat owns, Supplies, a check's public declaration,
 * the description editor, the image picker where files may be browsed, and Deal
 * XP on a party whose every member the seat owns. The party token's HUD offers
 * Form up to the seat, which presses it, and its picker draws no Forget unless
 * the seat may write settings. An ability the seat owns shows the Skill
 * checkbox, and its tab's fields are live.
 *
 * The same script runs on a real Player seat and again on a real Trusted seat:
 * the operator sets SEAT_PLAYER to the user of the role being walked. The walk
 * reads the role from the seat itself (1 Player, 2 Trusted) and expects the
 * Trusted seat's Image cell and plate press (core gives Trusted the file
 * browser) and the Player's lack of both. No user name is written here.
 *
 * Every fixture and figure is invented. Fixtures, kept and found again by
 * marker (`api.fixture`): the scene `formation/seat-frame-scene`; the party
 * `formation/seat-frame-party` with its token `formation/seat-frame-token`, its
 * `formation/seat-frame-ranger` (owned by the seat's user, rewritten at the
 * walk's start) and the Judge's `formation/seat-frame-smith`; the ability
 * `formation/seat-ranger-ability` on the ranger; the party
 * `formation/seat-whole-party` whose only member is the seat's own
 * `formation/seat-whole-member`; and, where the world has a Trusted user, the
 * party `formation/seat-trusted-party` whose only member
 * `formation/seat-trusted-member` that user owns. The walk brings each to its
 * start shape itself: members in order, an empty description, the party in the
 * delve, the ability unflagged.
 * Writes outside the ledger: two saved marching orders, created and forgotten by
 * id in the run; the cards the presses post are tracked by id and swept.
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
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
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
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    user: game.user.name,
    userId: game.user.id,
    role: game.user.role,
    canBrowse: !!game.user.can("FILES_BROWSE"),
    canSettings: !!game.user.can("SETTINGS_MODIFY"),
    trustedId: game.users.find((u) => u.role === CONST.USER_ROLES.TRUSTED)?.id ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    boot: globalThis.__sfBoot ?? null,
  }),

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
    H.marching = await import(`${base}formation/marching-templates.mjs`);
    H.travel = await import(`${base}formation/travel.mjs`);
    H.rolls = await import(`${base}formation/party-rolls.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.order = (fid) => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    H.pickers = () => [...foundry.applications.instances.values()].filter((a) => /FilePicker/.test(a.constructor?.name ?? ""));
    return { ok: typeof H.requests.userOwnsMember === "function" && typeof H.travel.setJourneyMode === "function" };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__sf;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  tokenData: async ({ actorId, xy }) => (await game.actors.get(actorId).getTokenDocument({ x: xy.x, y: xy.y })).toObject(),

  /**
   * A party brought to its start shape: its members in order (none added with a
   * token), an empty description, the delve, and the unflagged abilities. A
   * member's ownership is written whole, so a previous run's seat holds none.
   */
  startShape: async ({ fid, members, owned, seatId, abilities = [] }) => {
    const H = globalThis.__sf;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const id of members) {
      if (!H.model.getFormation(fid).members.some((m) => m?.actorId === id)) await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), null, { scene: null });
    }
    if (!same(H.order(fid), members)) {
      await H.model.patchFormation(fid, (rec) => {
        rec.members = members.map((id) => rec.members.find((m) => m?.actorId === id)).filter(Boolean);
      });
    }
    for (const id of owned) {
      await game.actors.get(id).update({ ownership: { default: 0, [seatId]: 3 } }, { diff: false, recursive: false });
    }
    await game.actors.get(H.model.getFormation(fid).actorId).update({ "system.description": "" });
    if (H.travel.travelOf(H.model.getFormation(fid)).mode !== "delve") await H.travel.setJourneyMode(fid, "delve");
    for (const uuid of abilities) {
      const item = fromUuidSync(uuid);
      for (const key of ["isSkill", "checkKey", "targetMod"]) await item?.unsetFlag("acks-extras", key);
    }
    await H.sleep(600);
    return { order: H.order(fid), mode: H.travel.travelOf(H.model.getFormation(fid)).mode };
  },

  setMode: async ({ fid, mode }) => {
    const H = globalThis.__sf;
    if (H.travel.travelOf(H.model.getFormation(fid)).mode !== mode) await H.travel.setJourneyMode(fid, mode);
    await H.sleep(700);
    return { mode: H.travel.travelOf(H.model.getFormation(fid)).mode };
  },

  owns: async ({ partyId, fid }) => {
    const H = globalThis.__sf;
    return { party: !!game.actors.get(partyId)?.isOwner, member: H.requests.userOwnsMember(H.model.getFormation(fid), game.user) };
  },

  observes: async ({ partyId }) => ({ observer: !!game.actors.get(partyId)?.testUserPermission(game.user, "OBSERVER") }),

  /** Save the party's order under a name, then put it the other way round so a form-up has something to restore. */
  saveOrder: async ({ fid, name, scramble }) => {
    const H = globalThis.__sf;
    const saved = await H.marching.saveTemplate(H.model.getFormation(fid), name);
    if (scramble) await H.model.patchFormation(fid, (rec) => void rec.members.reverse());
    await H.sleep(400);
    return { id: saved?.template?.id ?? null, order: H.order(fid), cells: (saved?.template?.cells ?? []).map((c) => c.actorId ?? null) };
  },

  forget: async ({ id }) => ({ forgotten: await globalThis.__sf.marching.deleteTemplate(id) }),

  order: async ({ fid }) => ({ order: globalThis.__sf.order(fid) }),

  awaitOrder: async ({ fid, expect }) => {
    const H = globalThis.__sf;
    return !!(await H.poll(() => JSON.stringify(H.order(fid)) === JSON.stringify(expect), { tries: 40, every: 200 }));
  },

  /**
   * Open the party sheet and read what it draws: each rail's cells (a press is a
   * button with its action, a reading a span), the plate's press, and the Key's
   * groups once opened and shut again.
   */
  frame: async ({ partyId, key = true }) => {
    const H = globalThis.__sf;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(1000);
    let el = H.root(app);
    if (el?.querySelector(".acks-extras-party-sheet__key")) {
      el.querySelector('[data-action="toggleKey"]')?.click();
      await H.sleep(500);
      el = H.root(app);
    }
    const glyph = (cell) => (cell.querySelector("i")?.className ?? "").replace("acks-extras-party-sheet__cell-glyph", "").trim();
    const cellOf = (cell) => {
      const press = cell.tagName === "BUTTON";
      return {
        action: press ? (cell.dataset.action ?? "button") : "reading",
        save: cell.dataset.save ?? null,
        check: cell.dataset.check ?? null,
        tip: cell.dataset.tooltip ?? "",
        name: press ? (cell.getAttribute("aria-label") ?? "") : (cell.querySelector(".acks-sr-only")?.textContent ?? ""),
        disabled: !!cell.disabled,
        icon: glyph(cell),
      };
    };
    const rails = {};
    for (const rail of el?.querySelectorAll(".acks-extras-party-sheet__rail") ?? []) {
      const kind = [...rail.classList].find((c) => c.startsWith("acks-extras-party-sheet__rail--"))?.split("--")[1];
      rails[kind] = [...rail.children].map(cellOf);
    }
    const edit = el?.querySelector(".acks-extras-party-sheet__plate-edit");
    const plate = { press: !!edit, tip: edit?.dataset.tooltip ?? "", name: edit?.getAttribute("aria-label") ?? "" };
    let groups = null;
    if (key) {
      el.querySelector('[data-action="toggleKey"]')?.click();
      await H.poll(() => H.root(app)?.querySelector(".acks-extras-party-sheet__key"), { tries: 20, every: 150 });
      groups = {};
      for (const group of H.root(app)?.querySelectorAll(".acks-extras-party-sheet__key-group") ?? []) {
        groups[group.dataset.groupKey] = [...group.querySelectorAll("li i")].map((i) => i.className.trim());
      }
      H.root(app)?.querySelector('[data-action="toggleKey"]')?.click();
      await H.sleep(500);
    }
    return { editable: !!app.isEditable, rails, plate, groups };
  },

  close: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** A real click on a control of the open sheet. */
  click: async ({ partyId, selector, settle = 1500 }) => {
    const H = globalThis.__sf;
    const control = H.root(game.actors.get(partyId).sheet)?.querySelector(selector);
    if (!control) return { found: false, selector };
    const disabled = !!control.disabled;
    control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },

  /** The Checks tool's picker, answered with the first check that is not a solo one. */
  pickCheck: async () => {
    const H = globalThis.__sf;
    const key = Object.entries(H.rolls.PARTY_CHECKS).find(([, cfg]) => !cfg.solo)?.[0];
    const button = await H.poll(() => document.querySelector(`.acks-extras-scroll button[data-action="${key}"]`), { tries: 30, every: 100 });
    if (!button) return { picked: null };
    button.click();
    await H.sleep(1800);
    return { picked: key };
  },

  /** The Deal XP dialog, answered with a small total. */
  dealXp: async ({ total }) => {
    const H = globalThis.__sf;
    const input = await H.poll(() => document.querySelector('.acks-extras-scroll input[name="total"]'), { tries: 30, every: 100 });
    if (!input) return { dialog: false };
    input.value = String(total);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const ok = input.closest("dialog, .application")?.querySelector('button[data-action="ok"]');
    ok?.click();
    await H.sleep(2000);
    return { dialog: true, pressed: !!ok };
  },

  xpOf: async ({ actorId }) => ({ xp: game.actors.get(actorId)?.system?.details?.xp?.value ?? null }),

  /** The description editor: text set through the element's value setter, then read from the party actor. */
  describe: async ({ partyId, text }) => {
    const H = globalThis.__sf;
    const editor = await H.poll(() => H.root(game.actors.get(partyId).sheet)?.querySelector('prose-mirror[name="system.description"]'), { tries: 30, every: 100 });
    if (!editor) return { editor: false };
    // The element's own value setter fires input and change, as its save does.
    editor.value = text;
    await H.poll(() => String(game.actors.get(partyId)?.system?.description ?? "").includes(text), { tries: 40, every: 200 });
    return { editor: true, description: game.actors.get(partyId).system?.description ?? null };
  },

  /** Whether a file picker is open on this seat, closed again. */
  pickerOpen: async () => {
    const H = globalThis.__sf;
    const opened = await H.poll(() => H.pickers().length, { tries: 30, every: 100 });
    for (const app of H.pickers()) { try { await app.close({ animate: false }); } catch (_e) { /* closed */ } }
    return { opened: !!opened };
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 20000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    return { scene: canvas.scene?.id === sceneId };
  },

  /**
   * The party token's HUD as this seat gets it. With `orderId` the Form up
   * button is clicked, the picker that opens is read for its buttons and
   * answered with that order, and the HUD is closed.
   */
  hud: async ({ actorId, orderId = null }) => {
    const H = globalThis.__sf;
    const placeable = await H.poll(() => canvas.tokens.placeables.find((t) => t.document.actorId === actorId));
    if (!placeable) return { token: false };
    try { canvas.tokens.activate(); } catch (_e) { /* active */ }
    placeable.control({ releaseOthers: true });
    await H.sleep(300);
    await canvas.hud.token.bind(placeable);
    const button = await H.poll(() => document.querySelector("#token-hud .acks-formation-hud"), { tries: 30, every: 100 });
    const out = { token: true, button: !!button, tip: button?.dataset.tooltip ?? null, expectedTip: game.i18n.localize("ACKS-FORMATION.hud.formUp") };
    if (button && orderId) {
      button.click();
      const select = await H.poll(() => [...document.querySelectorAll("select[name='id']")].find((s) => s.closest(".acks-extras-scroll")), { tries: 40, every: 100 });
      out.picker = !!select;
      if (select) {
        const dialog = select.closest("dialog, .application");
        out.buttons = [...dialog.querySelectorAll("button[data-action]")].filter((b) => !b.closest(".window-header")).map((b) => b.dataset.action);
        select.value = orderId;
        out.chose = select.value === orderId;
        dialog.querySelector('button[data-action="apply"]')?.click();
        await H.sleep(2500);
      }
    }
    try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
    try { canvas.tokens.releaseAll(); } catch (_e) { /* released */ }
    return out;
  },

  /** An ability's sheet on this seat: the Skill checkbox, its click, and the tab's fields. */
  skill: async ({ uuid, tick }) => {
    const H = globalThis.__sf;
    const item = await fromUuid(uuid);
    await item.sheet.render(true);
    await H.sleep(1200);
    const box = () => H.root(item.sheet)?.querySelector(".acks-formation-skill-check input[type='checkbox']");
    const out = { editable: !!item.sheet.isEditable, box: !!box(), flagBefore: item.getFlag("acks-extras", "isSkill") ?? null };
    if (tick && box()) {
      box().click();
      await H.poll(() => item.getFlag("acks-extras", "isSkill") === true, { tries: 30, every: 150 });
      await H.poll(() => H.root(item.sheet)?.querySelector(".acks-formation-skill-tab [data-field]"), { tries: 30, every: 150 });
      out.flagAfter = item.getFlag("acks-extras", "isSkill") ?? null;
      out.tab = !!H.root(item.sheet)?.querySelector(".acks-formation-skill-anchor");
      out.fields = [...(H.root(item.sheet)?.querySelectorAll(".acks-formation-skill-tab [data-field]") ?? [])].map((e) => ({ field: e.dataset.field, disabled: e.disabled }));
      box()?.click();
      await H.poll(() => item.getFlag("acks-extras", "isSkill") === false, { tries: 30, every: 150 });
      out.flagUnticked = item.getFlag("acks-extras", "isSkill") ?? null;
    }
    try { await item.sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return out;
  },

  cards: async ({ since }) => game.messages.contents
    .filter((m) => m.timestamp >= since)
    .map((m) => ({ id: m.id, alias: m.speaker?.alias ?? "", text: (m.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })),
  boot: async () => globalThis.__sfBoot ?? null,
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

/* ------------------------------------------------------------------ */
/*  The lists a seat's rails are read against (the approved board).     */
/* ------------------------------------------------------------------ */

const actionsOf = (cells) => (cells ?? []).map((c) => c.action);
/** The board's rails for a seat that owns a member, by mode; `every` adds Deal XP, `canBrowse` the Image tool. */
const expectedRails = ({ saves, mode, every, canBrowse }) => ({
  saves: [...Array(saves).fill("partySave"), "toggleMagical"],
  figures: mode === "journey" ? ["reading", "consumeRations", "goTab", "goTab", "goTab"] : ["reading", "consumeRations", "goTab", "togglePace", "goTab"],
  tools: [...(mode === "journey" ? ["partyChecks"] : ["partyChecks", "partyCheck"]), ...(every ? ["dealXp"] : [])],
  sheet: ["editDescription", ...(canBrowse ? ["editPartyImage"] : []), "toggleKey"],
});
const KEY_GROUP = { saves: "saves", figures: "figures", tools: "tools", sheet: "sheet" };

const open = {};
const held = { partyIds: [], orderIds: [] };
const cards = [];
const character = (name, ownership) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } }, ...(ownership ? { ownership } : {}) });

/** Every rail cell a seat drew has a tooltip and a name, and none is a dead control. */
const named = (frame) => Object.values(frame.rails).flat().every((c) => c.tip && c.name && !c.disabled);

/** The Key holds a group per rail drawn, each listing that rail's glyphs in order, and none for a rail left out. */
const keyMatches = (frame) => {
  const drawn = Object.keys(frame.rails).filter((k) => frame.rails[k].length && KEY_GROUP[k]);
  const groups = Object.keys(frame.groups ?? {}).sort();
  return same(groups, drawn.map((k) => KEY_GROUP[k]).sort()) && drawn.every((k) => same(frame.groups[KEY_GROUP[k]], frame.rails[k].map((c) => c.icon)));
};

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  open.player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  const { gm, player } = open;
  note("GM ready after (s)", await record(PORTS.gm, "gm", gm));
  note("seat ready after (s)", await record(PORTS.player, "seat", player));
  note("installed", [await run(gm, P.install), await run(player, P.install)]);
  const census = { gm: await run(gm, P.census), seat: await run(player, P.census) };
  const role = census.seat.role;
  note("seat", { role, canBrowse: census.seat.canBrowse, canSettings: census.seat.canSettings });
  if (role !== 1 && role !== 2) blocked(`the seat's role is ${role}; the walk is for a Player (1) or a Trusted (2) seat`);
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the relay would run there");
  check("the seat is a Player or a Trusted user, and the Judge's seat is a GM", census.gm.role >= 3, { gm: census.gm.role, seat: role });
  check("core's file browser follows the role: Trusted may browse, Player may not", census.seat.canBrowse === (role === 2), { role, canBrowse: census.seat.canBrowse });
  for (const [key, c] of Object.entries(census)) {
    check(`${key}: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }
  const canBrowse = census.seat.canBrowse;
  const canSettings = census.seat.canSettings;
  const seatId = census.seat.userId;
  const SEAT_NAME = census.seat.user;
  const yours = { default: 0, [seatId]: 3 };

  section("fixtures");
  const scene = await gm.fixture("formation/seat-frame-scene", "Scene", { name: "QA Seat Frame Scene", width: 1200, height: 800, grid: { size: 100 }, ownership: { default: 2 } });
  const party = await gm.fixture("formation/seat-frame-party", "Actor", { name: "QA Seat Frame Party", type: `${SCOPE}.party` });
  const ranger = await gm.fixture("formation/seat-frame-ranger", "Actor", character("QA Seat Frame Ranger", yours));
  const smith = await gm.fixture("formation/seat-frame-smith", "Actor", character("QA Seat Frame Smith"));
  const whole = await gm.fixture("formation/seat-whole-party", "Actor", { name: "QA Seat Whole Party", type: `${SCOPE}.party` });
  const wholeMember = await gm.fixture("formation/seat-whole-member", "Actor", character("QA Seat Whole Member", yours));
  const rangerAbility = await gm.fixture("formation/seat-ranger-ability", "Item", { name: "QA Seat Knack", type: "ability" }, { parent: ranger.uuid });
  // On a Trusted seat the Trusted party is the seat's own; on a Player seat it is some Trusted user's, where the world has one.
  const trustedUser = role === 2 ? seatId : census.gm.trustedId;
  let trusted = null;
  let trustedMember = null;
  if (trustedUser) {
    trusted = await gm.fixture("formation/seat-trusted-party", "Actor", { name: "QA Seat Trusted Party", type: `${SCOPE}.party` });
    trustedMember = await gm.fixture("formation/seat-trusted-member", "Actor", character("QA Seat Trusted Member", { default: 0, [trustedUser]: 3 }));
    trusted.user = trustedUser;
  } else {
    note("no Trusted user in this world", "the Trusted party is not built");
  }
  held.partyIds = [party.id, whole.id, ...(trusted ? [trusted.id] : [])];
  const token = await gm.fixture("formation/seat-frame-token", "Token", await run(gm, P.tokenData, { actorId: party.id, xy: { x: 400, y: 400 } }), { parent: scene.uuid });
  note("token", token.uuid);

  const formations = {
    party: await run(gm, P.formationOf, { partyId: party.id }),
    whole: await run(gm, P.formationOf, { partyId: whole.id }),
    trusted: trusted ? await run(gm, P.formationOf, { partyId: trusted.id }) : null,
  };
  for (const [key, f] of Object.entries(formations)) if (f?.error) throw new Error(`${key}: ${f.error}`);
  const shapes = {
    party: await run(gm, P.startShape, { fid: formations.party.fid, members: [ranger.id, smith.id], owned: [ranger.id], seatId, abilities: [rangerAbility.uuid] }),
    whole: await run(gm, P.startShape, { fid: formations.whole.fid, members: [wholeMember.id], owned: [wholeMember.id], seatId }),
  };
  if (trusted) shapes.trusted = await run(gm, P.startShape, { fid: formations.trusted.fid, members: [trustedMember.id], owned: [trustedMember.id], seatId: trustedUser });
  note("start shapes", shapes);
  check("every party starts in the delve with its members in order", shapes.party.mode === "delve" && same(shapes.party.order, [ranger.id, smith.id]) && same(shapes.whole.order, [wholeMember.id]), shapes);
  for (const [key, partyId, fid] of [["party", party.id, formations.party.fid], ["whole", whole.id, formations.whole.fid]]) {
    let owns = await run(player, P.owns, { partyId, fid });
    for (let n = 0; n < 20 && !(owns.party && owns.member); n++) { await sleep(300); owns = await run(player, P.owns, { partyId, fid }); }
    check(`the seat owns a member of the ${key} party, and through it the party actor`, owns.member && owns.party, owns);
  }
  const since = await run(gm, P.nowMs);
  // A card is the run's own when it names, or speaks as, one of the run's QA Seat fixtures.
  const sweepable = (card) => /QA Seat/.test(card.text) || /^QA Seat/.test(card.alias);

  section("the Judge's own frame, for the seat to be read against");
  const judgeFrame = await run(gm, P.frame, { partyId: party.id });
  const saveCount = judgeFrame.rails.saves.filter((c) => c.action === "partySave").length;
  note("saves on the Judge's rail", saveCount);
  check("the Judge's rails are as shipped: every save and the Magical toggle; encounter, checks, search, pause and XP; the four document tools and the Key",
    same(actionsOf(judgeFrame.rails.saves), [...Array(saveCount).fill("partySave"), "toggleMagical"])
    && same(actionsOf(judgeFrame.rails.tools), ["encounterNow", "partyChecks", "partyCheck", "togglePause", "dealXp"])
    && same(actionsOf(judgeFrame.rails.sheet), ["editDescription", "editPartyImage", "ownership", "tweaks", "toggleKey"])
    && judgeFrame.plate.press, judgeFrame.rails);
  await run(gm, P.close, { partyId: party.id });

  section(`the ${role === 2 ? "Trusted" : "Player"} seat owning one of two members, in the delve`);
  let frame = await run(player, P.frame, { partyId: party.id });
  check("the sheet is live for the seat", frame.editable, frame.editable);
  let want = expectedRails({ saves: saveCount, mode: "delve", every: false, canBrowse });
  for (const kind of ["saves", "figures", "tools", "sheet"]) {
    check(`the ${kind} rail draws the board's cells for this seat`, same(actionsOf(frame.rails[kind]), want[kind]), { drawn: actionsOf(frame.rails[kind]), want: want[kind] });
  }
  check("no Encounter, Pause, Ownership or Tweaks, and no XP on a seat owning one of two", !Object.values(frame.rails).flat().some((c) => ["encounterNow", "travelEncounterThrow", "togglePause", "ownership", "tweaks", "dealXp", "adjustHp"].includes(c.action)));
  check(canBrowse ? "the plate is a press that opens the picker" : "the plate is a picture, and no Image tool is drawn", frame.plate.press === canBrowse, frame.plate);
  check("every drawn cell has a tooltip and a name, and none is disabled", named(frame), Object.values(frame.rails).flat().filter((c) => !c.tip || !c.name || c.disabled));
  check("the plate's press, where drawn, carries a tooltip and a name", !frame.plate.press || (frame.plate.tip && frame.plate.name), frame.plate);
  check("a save says whose members it rolls for, and Supplies whom it rations",
    frame.rails.saves.filter((c) => c.action === "partySave").every((c) => c.tip.includes("whose character you own"))
    && frame.rails.figures.find((c) => c.action === "consumeRations")?.tip.includes("the members you own"),
    { save: frame.rails.saves[0]?.tip, supplies: frame.rails.figures[1]?.tip });
  check("the Key lists exactly the drawn cells", keyMatches(frame), { groups: frame.groups, rails: Object.fromEntries(Object.entries(frame.rails).map(([k, v]) => [k, v.length])) });

  section("one real click per newly drawn press");
  const t1 = await run(gm, P.nowMs);
  const saveCell = frame.rails.saves.find((c) => c.action === "partySave");
  note("first save", saveCell?.save);
  let r = await run(player, P.click, { partyId: party.id, selector: `[data-action="partySave"][data-save="${saveCell?.save}"]` });
  check("a save cell is pressed", r.found && !r.disabled, r);
  await sleep(800);
  let fresh = (await run(gm, P.cards, { since: t1 })).filter((c) => /QA Seat Frame/.test(c.text));
  check("the save card names the member the seat owns and not the Judge's", fresh.some((c) => c.text.includes("QA Seat Frame Ranger")) && !fresh.some((c) => c.text.includes("QA Seat Frame Smith")), fresh.map((c) => c.text));

  const t2 = await run(gm, P.nowMs);
  r = await run(player, P.click, { partyId: party.id, selector: '[data-action="consumeRations"]' });
  check("Supplies is pressed", r.found && !r.disabled, r);
  await sleep(800);
  fresh = (await run(gm, P.cards, { since: t2 })).filter((c) => /QA Seat Frame/.test(c.text));
  check("Supplies spends for the member the seat owns and names no one else", fresh.length === 1 && fresh[0].text.includes("QA Seat Frame Ranger") && !fresh[0].text.includes("QA Seat Frame Smith"), fresh.map((c) => c.text));

  const t3 = await run(gm, P.nowMs);
  r = await run(player, P.click, { partyId: party.id, selector: '[data-action="partyCheck"][data-check="searchMethodical"]', settle: 1800 });
  check("the methodical search is pressed", r.found && !r.disabled, r);
  fresh = await run(gm, P.cards, { since: t3 });
  check("its declaration is public and reaches the table through the Judge's client", fresh.some((c) => /a party/i.test(c.text) && c.text.includes(SEAT_NAME)), fresh.map((c) => c.text));
  const seen = (await run(player, P.cards, { since: t3 })).filter((c) => /a party/i.test(c.text));
  check("and the seat sees its own declaration", seen.length >= 1, seen.map((c) => c.text));

  const t4 = await run(gm, P.nowMs);
  r = await run(player, P.click, { partyId: party.id, selector: '[data-action="partyChecks"]', settle: 600 });
  const picked = await run(player, P.pickCheck);
  check("the Checks tool opens its picker, and the pick is declared", r.found && !!picked.picked, { r, picked });
  fresh = await run(gm, P.cards, { since: t4 });
  check("the picked check's declaration names the seat", fresh.some((c) => /a party/i.test(c.text) && c.text.includes(SEAT_NAME)), fresh.map((c) => c.text));

  r = await run(player, P.click, { partyId: party.id, selector: '[data-action="editDescription"]', settle: 900 });
  const typed = await run(player, P.describe, { partyId: party.id, text: "<p>QA seat frame note</p>" });
  check("the description tool opens the editor, and text sent through it lands in the party actor", r.found && typed.editor && /QA seat frame note/.test(typed.description ?? ""), { r, typed });
  await run(player, P.click, { partyId: party.id, selector: '[data-action="editDescription"]', settle: 600 });

  if (canBrowse) {
    await run(player, P.click, { partyId: party.id, selector: '[data-action="editPartyImage"]', settle: 600 });
    check("the Image tool opens the file picker", (await run(player, P.pickerOpen)).opened);
    await run(player, P.click, { partyId: party.id, selector: ".acks-extras-party-sheet__plate-edit", settle: 600 });
    check("and so does the plate", (await run(player, P.pickerOpen)).opened);
  } else {
    check("no Image tool and no plate press exist to press on a seat that may not browse files", !(await run(player, P.frame, { partyId: party.id, key: false })).plate.press);
  }
  await run(player, P.close, { partyId: party.id });

  section("on a journey");
  await run(gm, P.setMode, { fid: formations.party.fid, mode: "journey" });
  await run(player, P.close, { partyId: party.id });
  frame = await run(player, P.frame, { partyId: party.id });
  want = expectedRails({ saves: saveCount, mode: "journey", every: false, canBrowse });
  for (const kind of ["saves", "figures", "tools", "sheet"]) {
    check(`journey: the ${kind} rail draws the board's cells`, same(actionsOf(frame.rails[kind]), want[kind]), { drawn: actionsOf(frame.rails[kind]), want: want[kind] });
  }
  check("journey: no search cell is drawn, dead or live, and the Key lists what is drawn", !Object.values(frame.rails).flat().some((c) => c.action === "searchHour" || c.check === "searchMethodical") && keyMatches(frame) && named(frame));
  await run(player, P.close, { partyId: party.id });
  await run(gm, P.setMode, { fid: formations.party.fid, mode: "delve" });

  section("a seat owning every member: Deal XP");
  frame = await run(player, P.frame, { partyId: whole.id });
  want = expectedRails({ saves: saveCount, mode: "delve", every: true, canBrowse });
  for (const kind of ["saves", "figures", "tools", "sheet"]) {
    check(`the ${kind} rail draws the board's cells`, same(actionsOf(frame.rails[kind]), want[kind]), { drawn: actionsOf(frame.rails[kind]), want: want[kind] });
  }
  check("every drawn cell has a tooltip and a name, and the Key lists them", named(frame) && keyMatches(frame));
  const before = (await run(gm, P.xpOf, { actorId: wholeMember.id })).xp;
  const t5 = await run(gm, P.nowMs);
  r = await run(player, P.click, { partyId: whole.id, selector: '[data-action="dealXp"]', settle: 600 });
  const dealt = await run(player, P.dealXp, { total: 10 });
  const afterXp = (await run(gm, P.xpOf, { actorId: wholeMember.id })).xp;
  note("experience", { before, after: afterXp });
  check("Deal XP opens its dialog and a small total is dealt to the member the seat owns", r.found && dealt.dialog && dealt.pressed && afterXp > (before ?? 0), { r, dealt, before, afterXp });
  fresh = (await run(gm, P.cards, { since: t5 })).filter((c) => c.text.includes("QA Seat Whole Member"));
  const atSeat = (await run(player, P.cards, { since: t5 })).filter((c) => c.text.includes("QA Seat Whole Member"));
  check("the deal's card reaches the Judge and the dealing seat", fresh.length >= 1 && atSeat.length >= 1, { gm: fresh.length, seat: atSeat.length });
  await run(player, P.close, { partyId: whole.id });

  if (trusted) {
    section("a party whose only member the Trusted user owns");
    if (role === 2) {
      frame = await run(player, P.frame, { partyId: trusted.id });
      want = expectedRails({ saves: saveCount, mode: "delve", every: true, canBrowse });
      check("the Trusted seat's rails are the whole-party seat's with the Image tool", same(actionsOf(frame.rails.tools), want.tools) && same(actionsOf(frame.rails.sheet), want.sheet) && frame.plate.press, { tools: actionsOf(frame.rails.tools), sheet: actionsOf(frame.rails.sheet), plate: frame.plate });
      await run(player, P.close, { partyId: trusted.id });
    } else {
      const seeing = await run(player, P.observes, { partyId: trusted.id });
      if (seeing.observer) {
        frame = await run(player, P.frame, { partyId: trusted.id });
        check("a seat owning no member of the party has no saves rail and no tools, and of the sheet tools the Key", !frame.rails.saves && !frame.rails.tools && same(actionsOf(frame.rails.sheet), ["toggleKey"]), frame.rails);
        await run(player, P.close, { partyId: trusted.id });
      } else {
        note("the Player cannot open the Trusted user's party", "the no-member negative is covered offline");
      }
    }
  }

  section("the party token's HUD");
  const orderA = await run(gm, P.saveOrder, { fid: formations.party.fid, name: "QA Seat Frame Order A", scramble: false });
  const orderB = await run(gm, P.saveOrder, { fid: formations.party.fid, name: "QA Seat Frame Order B", scramble: true });
  held.orderIds = [orderA.id, orderB.id];
  check("two saved orders exist and the party stands the other way round", !!orderA.id && !!orderB.id && orderB.order[0] === smith.id, { orderA, orderB });
  const viewed = await run(player, P.view, { sceneId: scene.id });
  check("the seat views the scene carrying the party token", viewed.scene, viewed);
  const t6 = await run(gm, P.nowMs);
  const hud = await run(player, P.hud, { actorId: party.id, orderId: orderA.id });
  note("hud", hud);
  check("the party token's HUD offers Form up to a seat owning a member, with its tooltip", hud.token && hud.button && hud.tip === hud.expectedTip, hud);
  check("the picker opens", !!hud.picker, hud);
  check(canSettings ? "the picker draws Forget, since this seat may write settings" : "the picker draws no Forget", hud.picker && same(hud.buttons, canSettings ? ["apply", "delete"] : ["apply"]), hud.buttons);
  check("the Judge's client puts the party back in the saved order", await run(gm, P.awaitOrder, { fid: formations.party.fid, expect: [ranger.id, smith.id] }));
  fresh = await run(gm, P.cards, { since: t6 });
  check("one public line names the order and the seat", fresh.filter((c) => c.text.includes("forms up in QA Seat Frame Order A")).length === 1, fresh.map((c) => c.text));

  section("an ability the seat owns");
  const noTick = await run(player, P.skill, { uuid: rangerAbility.uuid, tick: false });
  check("the ability's sheet is editable on the seat and draws the Skill checkbox", noTick.editable && noTick.box, noTick);
  const ticked = await run(player, P.skill, { uuid: rangerAbility.uuid, tick: true });
  check("ticking it sets the isSkill flag and draws the Skill tab", ticked.flagAfter === true && ticked.tab, ticked);
  check("the tab's fields are editable", Array.isArray(ticked.fields) && ticked.fields.length > 0 && ticked.fields.every((f) => !f.disabled), ticked.fields);
  check("unticking clears it again", ticked.flagUnticked === false, ticked.flagUnticked);

  section("what the table saw");
  await sleep(600);
  const posted = await run(gm, P.cards, { since });
  for (const card of posted.filter((c) => sweepable(c))) cards.push(gm.track(card.id, "ChatMessage"));
  note("cards tracked", cards.length);

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
  for (const partyId of held.partyIds) {
    try { if (open.player) await run(open.player, P.close, { partyId }); } catch (_e) { /* closed */ }
    try { if (open.gm) await run(open.gm, P.close, { partyId }); } catch (_e) { /* closed */ }
  }
  for (const id of held.orderIds) {
    try { if (open.gm && id) note("saved order forgotten", await run(open.gm, P.forget, { id })); } catch (err) { console.error("forget:", err?.message ?? err); }
  }
  try { if (open.gm && cards.length) note("cards swept", await open.gm.sweepTracked({ only: cards })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
