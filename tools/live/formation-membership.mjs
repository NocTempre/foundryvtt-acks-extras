/**
 * Live walk: docs/formation/TESTING.md "A player's own actors, in and out". A
 * Player seat with no member in the party, and so no way to open its sheet,
 * joins by the HUD button on its own token, opens the sheet it now owns, brings
 * a follower in from the Order tab's list and again by a drop from the sidebar,
 * takes them out, and leaves. The relay refuses an actor that is not the
 * sender's, one already in another party, and either way during a fight; a
 * mounted member keeps the mount across leaving and joining; and no load error
 * lands on either seat under a recorder added before reload.
 *
 * Every fixture and figure is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): the scene `membership/scene`; the party `membership/party`
 * with `membership/anchor`, the Judge's, who keeps its token on the map; the
 * Player seat's `membership/lead`, who stands on the map, `membership/follower`,
 * who has no token, and the animal `membership/pony`; `membership/stranger`,
 * nobody's; and `membership/rival` holding the Player seat's `membership/taken`.
 * The walk brings them to its start shape itself: only the anchor in the party,
 * the lead's token on the map, nobody mounted.
 * Writes outside the ledger: the party's combat flag, put back in the finally.
 * The cards the relay posts are tracked by id and swept in the finally.
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
  const R = (globalThis.__mbBoot = { phase: "load", phases: [], errors: [] });
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
    boot: globalThis.__mbBoot ?? null,
  }),

  install: async () => {
    const H = (globalThis.__mb = globalThis.__mb ?? {});
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
    H.membership = await import(`${base}formation/membership.mjs`);
    H.attachment = await import(`${base}lib/attachment.mjs`);
    H.mount = await import(`${base}lib/mount.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.ids = (fid) => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    if (!H.notes) {
      H.notes = [];
      for (const level of ["info", "warn"]) {
        const fn = ui.notifications[level];
        ui.notifications[level] = function (msg, ...rest) {
          H.notes.push(String(msg));
          return fn.call(this, msg, ...rest);
        };
      }
    }
    return { ok: typeof H.membership.bringInRefusal === "function" };
  },

  /** The record behind a party actor, once its create hook has made one. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__mb;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /**
   * Only the anchor in the party, its token holding the party on the map; the
   * lead's own token on the map; nobody mounted. A token is made where a kept
   * run left none, and the rival holds the taken actor.
   */
  startShape: async ({ fid, rivalFid, sceneId, anchor, lead, follower, taken }) => {
    const H = globalThis.__mb;
    const scene = game.scenes.get(sceneId);
    await H.model.patchFormation(fid, (rec) => void (rec.combat = null));
    for (const id of [lead, follower]) {
      const actor = game.actors.get(id);
      if (H.attachment.attachmentOf(actor)) await H.attachment.detach(actor);
      if (H.model.getFormation(fid).members.some((m) => m?.actorId === id)) await H.model.removeMember(H.model.getFormation(fid), id);
    }
    if (!H.model.getFormation(fid).members.some((m) => m?.actorId === anchor)) {
      const doc = await game.actors.get(anchor).getTokenDocument({ x: 300, y: 300 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await H.model.addMember(H.model.getFormation(fid), game.actors.get(anchor), made);
    }
    if (!H.model.getFormation(rivalFid).members.some((m) => m?.actorId === taken)) await H.model.addMember(H.model.getFormation(rivalFid), game.actors.get(taken), null, { scene: null });
    if (!scene.tokens.some((t) => t.actorId === lead)) {
      const doc = await game.actors.get(lead).getTokenDocument({ x: 600, y: 300 });
      await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
    }
    await H.sleep(600);
    const f = H.model.getFormation(fid);
    return { members: H.ids(fid), sceneId: f.sceneId, partyToken: !!H.model.getPartyToken(f), leadToken: scene.tokens.some((t) => t.actorId === lead) };
  },

  /** What this seat may do with the party at all. */
  access: async ({ partyId }) => {
    const party = game.actors.get(partyId);
    return { sees: !!party?.testUserPermission(game.user, "OBSERVER"), owns: !!party?.testUserPermission(game.user, "OWNER") };
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 20000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    return { scene: canvas.scene?.id === sceneId };
  },

  /** The token's HUD as this seat gets it, and a press of the party button on it. */
  hud: async ({ actorId, press }) => {
    const H = globalThis.__mb;
    const placeable = await H.poll(() => canvas.tokens.placeables.find((t) => t.document.actorId === actorId));
    if (!placeable) return { token: false };
    try { canvas.tokens.activate(); } catch (_e) { /* active */ }
    placeable.control({ releaseOthers: true });
    await H.sleep(300);
    await canvas.hud.token.bind(placeable);
    const button = await H.poll(() => document.querySelector("#token-hud .acks-formation-hud"), { tries: 30, every: 100 });
    const tip = button?.dataset.tooltip ?? null;
    if (press) button?.click();
    await H.sleep(press ? 1500 : 100);
    try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
    try { canvas.tokens.releaseAll(); } catch (_e) { /* released */ }
    return { token: true, button: !!button, tip };
  },

  open: async ({ partyId, tab = "order" }) => {
    const H = globalThis.__mb;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    H.root(app)?.querySelector(`[data-action="tab"][data-tab="${tab}"]`)?.click();
    await H.sleep(300);
    return { rendered: !!H.root(app), editable: !!app.isEditable };
  },

  close: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  /** The Order tab's list, and the leave control on a member's row. */
  sheet: async ({ partyId, actorIds }) => {
    const H = globalThis.__mb;
    const app = game.actors.get(partyId).sheet;
    const el = H.root(app);
    const section = el?.querySelector(".acks-extras-formation-bring-in");
    const buttons = [...(section?.querySelectorAll('[data-action="bringIn"]') ?? [])];
    return {
      open: app.rendered,
      listed: buttons.filter((b) => actorIds.includes(b.dataset.actorId)).map((b) => b.dataset.actorId),
      count: buttons.length,
      locked: buttons.some((b) => b.disabled),
      hint: section?.querySelector(".hint")?.textContent ?? null,
      leave: Object.fromEntries(actorIds.map((id) => {
        const control = el?.querySelector(`li.member[data-actor-id="${id}"] [data-action="removeMember"]`);
        return [id, control ? { disabled: control.disabled, label: control.getAttribute("aria-label") } : null];
      })),
    };
  },

  /** A press on the open sheet, as a click. */
  press: async ({ partyId, selector, settle = 1500 }) => {
    const H = globalThis.__mb;
    const control = H.root(game.actors.get(partyId).sheet)?.querySelector(selector);
    if (!control) return { found: false, selector };
    const disabled = !!control.disabled;
    control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },

  /** A drop from the sidebar on the open sheet's root, read by the event a browser sends. */
  drop: async ({ partyId, actorId }) => {
    const H = globalThis.__mb;
    const el = H.root(game.actors.get(partyId).sheet);
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid: game.actors.get(actorId).uuid }));
    el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
    await H.sleep(1500);
    return { sent: true };
  },

  /** A request as a client could send it, past the sheet's own refusal. */
  relay: async ({ fid, type, payload }) => {
    const H = globalThis.__mb;
    await H.requests.requestPartyAction(fid, type, payload);
    await H.sleep(1500);
    return { sent: true };
  },

  /** Who is in the party, read on this seat, and where the actor's own tokens stand. */
  members: async ({ fid, sceneId, actorId }) => {
    const H = globalThis.__mb;
    const scene = game.scenes.get(sceneId);
    const member = H.model.getFormation(fid).members.find((m) => m?.actorId === actorId) ?? null;
    return { ids: H.ids(fid), in: !!member, stashed: !!member?.tokenData, tokens: scene.tokens.filter((t) => t.actorId === actorId).length };
  },

  /** Poll for the party's roster to read as expected, on this seat. */
  awaitIn: async ({ fid, actorId, present }) => {
    const H = globalThis.__mb;
    return !!(await H.poll(() => H.ids(fid).includes(actorId) === present));
  },

  setCombat: async ({ fid, value }) => {
    const H = globalThis.__mb;
    await H.model.patchFormation(fid, (rec) => void (rec.combat = value));
    await H.sleep(500);
    return { combat: H.model.getFormation(fid).combat ?? null };
  },

  mount: async ({ riderId, mountId }) => {
    const H = globalThis.__mb;
    const done = await H.mount.mountActor(game.actors.get(riderId), game.actors.get(mountId));
    await H.sleep(300);
    return { done: !!done, on: H.attachment.attachmentOf(game.actors.get(riderId))?.uuid ?? null };
  },

  attached: async ({ actorId }) => ({ on: globalThis.__mb.attachment.attachmentOf(game.actors.get(actorId))?.uuid ?? null }),

  frame: async ({ partyId, width, selector }) => {
    const H = globalThis.__mb;
    const app = game.actors.get(partyId).sheet;
    app.setPosition({ width, height: Math.min(window.innerHeight - 40, 860) });
    await H.sleep(400);
    const el = H.root(app)?.querySelector(selector);
    el?.scrollIntoView({ block: "start" });
    await H.sleep(250);
    const box = el?.getBoundingClientRect();
    const clipped = [...(el?.querySelectorAll("button") ?? [])]
      .filter((node) => node.getBoundingClientRect().right > box.right + 1)
      .map((node) => node.textContent.trim());
    return { width: app.position.width, overflow: !!el && el.scrollWidth > el.clientWidth + 1, clipped };
  },

  takeNotes: async () => globalThis.__mb.notes.splice(0),
  cards: async ({ since, words }) => game.messages.contents
    .filter((m) => m.timestamp >= since && words.some((w) => (m.content ?? "").includes(w)))
    .map((m) => ({ id: m.id, text: (m.content ?? "").replace(/<[^>]+>/g, "") })),
  boot: async () => globalThis.__mbBoot ?? null,
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
const held = { fid: null, prior: null };

const character = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
const animal = (name, run_) => ({
  name,
  type: `${SCOPE}.animal`,
  system: { animal: { mountable: true } },
  flags: { [SCOPE]: { extras: { speeds: [{ type: "land", run: run_ }] } } },
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
  for (const [key, c] of Object.entries(census)) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }

  section("fixtures");
  const yours = { default: 0, [census.player.userId]: 3 };
  const scene = await gm.fixture("membership/scene", "Scene", { name: "Membership Walk", width: 1200, height: 800, grid: { size: 100 }, ownership: { default: 2 } });
  const party = await gm.fixture("membership/party", "Actor", { name: "QA Door Party", type: `${SCOPE}.party` });
  const rival = await gm.fixture("membership/rival", "Actor", { name: "QA Other Party", type: `${SCOPE}.party` });
  const anchor = await gm.fixture("membership/anchor", "Actor", character("QA Anchor"));
  const lead = await gm.fixture("membership/lead", "Actor", { ...character("QA Lead"), ownership: yours });
  const follower = await gm.fixture("membership/follower", "Actor", { ...character("QA Follower"), ownership: yours });
  const stranger = await gm.fixture("membership/stranger", "Actor", character("QA Stranger"));
  const taken = await gm.fixture("membership/taken", "Actor", { ...character("QA Taken"), ownership: yours });
  const pony = await gm.fixture("membership/pony", "Actor", { ...animal("QA Door Pony", 240), ownership: yours });
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  const rivalRecord = await run(gm, P.formationOf, { partyId: rival.id });
  if (error || rivalRecord.error) throw new Error(error ?? rivalRecord.error);
  held.fid = fid;
  const shape = await run(gm, P.startShape, { fid, rivalFid: rivalRecord.fid, sceneId: scene.id, anchor: anchor.id, lead: lead.id, follower: follower.id, taken: taken.id });
  note("start shape", shape);
  check("the walk starts with only the anchor in the party, its token on the map, and the lead on the map", shape.members.length === 1 && shape.members[0] === anchor.id && shape.partyToken && shape.leadToken && shape.sceneId === scene.id, shape);
  const since = await run(gm, P.nowMs);
  const watch = ["QA Lead", "QA Follower", "QA Stranger", "QA Taken"];
  const seen = { sceneId: scene.id, fid };

  section("a player with no member in the party");
  let access = await run(player, P.access, { partyId: party.id });
  await sleep(600);
  access = await run(player, P.access, { partyId: party.id });
  check("the seat can neither see nor own the party, so no sheet of it can open", !access.sees && !access.owns, access);
  check("the viewing seat reaches the scene", (await run(player, P.view, { sceneId: scene.id })).scene);
  await run(player, P.takeNotes);
  const hud = await run(player, P.hud, { actorId: lead.id, press: true });
  note("HUD", hud);
  check("the seat's own token offers the party button, named for a player", hud.button && /Bring into the party/.test(hud.tip ?? ""), hud);
  check("the press reaches the GM client", await run(gm, P.awaitIn, { fid, actorId: lead.id, present: true }));
  let m = await run(gm, P.members, { ...seen, actorId: lead.id });
  check("the lead stands in the party with their token stashed, and off the map", m.in && m.stashed && m.tokens === 0, m);
  access = await run(player, P.access, { partyId: party.id });
  for (let n = 0; n < 10 && !access.owns; n++) { await sleep(300); access = await run(player, P.access, { partyId: party.id }); }
  check("the party is the seat's own now", access.owns, access);

  section("the sheet the seat just gained");
  const opened = await run(player, P.open, { partyId: party.id });
  check("the sheet opens live", opened.rendered && opened.editable, opened);
  let sheet = await run(player, P.sheet, { partyId: party.id, actorIds: [lead.id, follower.id, stranger.id, taken.id, pony.id, anchor.id] });
  note("Order tab", sheet);
  check("the list offers the follower and neither the stranger, nor one in another party, nor a mount", sheet.listed.includes(follower.id) && !sheet.listed.includes(stranger.id) && !sheet.listed.includes(taken.id) && !sheet.listed.includes(pony.id), sheet.listed);
  check("the seat's own member has the leave control, with a name; the anchor's row has none", !!sheet.leave[lead.id]?.label && !sheet.leave[lead.id].disabled && !sheet.leave[anchor.id], sheet.leave);

  await run(player, P.press, { partyId: party.id, selector: `[data-action="bringIn"][data-actor-id="${follower.id}"]` });
  check("a press on the list brings the follower in", await run(gm, P.awaitIn, { fid, actorId: follower.id, present: true }));
  m = await run(gm, P.members, { ...seen, actorId: follower.id });
  check("with no token to stash, and none on the map", m.in && !m.stashed && m.tokens === 0, m);
  await sleep(600);
  sheet = await run(player, P.sheet, { partyId: party.id, actorIds: [follower.id] });
  check("the sheet redraws: off the list, and on a row with a leave control", !sheet.listed.length && !!sheet.leave[follower.id], sheet);

  await run(player, P.press, { partyId: party.id, selector: `li.member[data-actor-id="${follower.id}"] [data-action="removeMember"]` });
  check("the row's control takes the follower out", await run(gm, P.awaitIn, { fid, actorId: follower.id, present: false }));
  await sleep(600);
  sheet = await run(player, P.sheet, { partyId: party.id, actorIds: [follower.id] });
  check("and they are back on the list", sheet.listed.includes(follower.id), sheet.listed);

  await run(player, P.drop, { partyId: party.id, actorId: follower.id });
  check("a drop from the sidebar brings the follower in", await run(gm, P.awaitIn, { fid, actorId: follower.id, present: true }));
  await sleep(400);
  await run(player, P.press, { partyId: party.id, selector: `li.member[data-actor-id="${follower.id}"] [data-action="removeMember"]` });
  await run(gm, P.awaitIn, { fid, actorId: follower.id, present: false });

  section("refusals");
  await sleep(400);
  await run(player, P.takeNotes);
  await run(player, P.drop, { partyId: party.id, actorId: stranger.id });
  let notes = await run(player, P.takeNotes);
  m = await run(gm, P.members, { ...seen, actorId: stranger.id });
  check("a drop of another's actor is refused with its reason, and writes nothing", !m.in && notes.some((n) => /is not yours/.test(n) && n.includes("QA Stranger")), { notes, in: m.in });
  await run(player, P.drop, { partyId: party.id, actorId: taken.id });
  notes = await run(player, P.takeNotes);
  m = await run(gm, P.members, { ...seen, actorId: taken.id });
  check("a drop of one in another party names that party, and writes nothing", !m.in && notes.some((n) => n.includes("QA Other Party")), { notes, in: m.in });
  await run(player, P.relay, { fid, type: "bringIn", payload: { actorId: stranger.id } });
  m = await run(gm, P.members, { ...seen, actorId: stranger.id });
  check("the GM client refuses the same actor past the sheet's check", !m.in, m);
  await run(player, P.relay, { fid, type: "takeOut", payload: { actorId: anchor.id } });
  m = await run(gm, P.members, { ...seen, actorId: anchor.id });
  check("and will not take out a member who is not the sender's", m.in, m);
  await run(player, P.relay, { fid, type: "bringIn", payload: { actorId: party.id } });
  m = await run(gm, P.members, { ...seen, actorId: party.id });
  check("and a party cannot stand in a party, whoever owns it", !m.in, m);

  section("during a fight");
  await run(gm, P.setCombat, { fid, value: { active: true, combatId: "qamembership" } });
  await sleep(500);
  await run(player, P.close, { partyId: party.id });
  await run(player, P.open, { partyId: party.id });
  sheet = await run(player, P.sheet, { partyId: party.id, actorIds: [lead.id, follower.id] });
  note("Order tab in a fight", sheet);
  check("the list and the leave control are held, and the sheet says why", sheet.locked && sheet.leave[lead.id]?.disabled && /during a combat/.test(sheet.hint ?? ""), sheet);
  await run(player, P.relay, { fid, type: "bringIn", payload: { actorId: follower.id } });
  await run(player, P.relay, { fid, type: "takeOut", payload: { actorId: lead.id } });
  const fought = { follower: await run(gm, P.members, { ...seen, actorId: follower.id }), lead: await run(gm, P.members, { ...seen, actorId: lead.id }) };
  check("and the GM client takes neither request past them", !fought.follower.in && fought.lead.in, fought);
  await run(gm, P.setCombat, { fid, value: null });

  section("a mounted member leaves and comes back");
  await run(player, P.close, { partyId: party.id });
  await run(player, P.open, { partyId: party.id });
  const mounted = await run(player, P.mount, { riderId: lead.id, mountId: pony.id });
  check("the lead is on the pony", !!mounted.on, mounted);

  const plateList = ".acks-extras-formation-bring-in";
  await gm.compose?.(`#${(await gm.eval(`game.actors.get(${JSON.stringify(party.id)}).sheet.id`))}`);
  try {
    const wide = await run(player, P.frame, { partyId: party.id, width: 920, selector: plateList });
    await player.shot(path.join(logDir(), "membership-order.png"), plateList);
    const narrow = await run(player, P.frame, { partyId: party.id, width: 560, selector: plateList });
    await player.shot(path.join(logDir(), "membership-order-narrow.png"), plateList);
    check("the list fits its sheet, wide and narrow, with nothing past the edge", !wide.overflow && !narrow.overflow && !wide.clipped.length && !narrow.clipped.length, { wide, narrow });
    note("plates", "written to the log directory");
  } catch (err) { console.log(`plates not taken: ${err?.message ?? err}`); }

  await run(player, P.press, { partyId: party.id, selector: `li.member[data-actor-id="${lead.id}"] [data-action="removeMember"]` });
  check("the lead's own control takes them out", await run(gm, P.awaitIn, { fid, actorId: lead.id, present: false }));
  await sleep(800);
  m = await run(gm, P.members, { ...seen, actorId: lead.id });
  check("and their stashed token returns to the map", !m.in && m.tokens === 1, m);
  const off = await run(gm, P.attached, { actorId: lead.id });
  check("still on the pony", off.on === mounted.on, off);
  access = await run(player, P.access, { partyId: party.id });
  for (let n = 0; n < 10 && access.owns; n++) { await sleep(300); access = await run(player, P.access, { partyId: party.id }); }
  check("with no member left the party is the seat's no longer", !access.owns, access);
  check("the HUD offers the way back", (await run(player, P.hud, { actorId: lead.id, press: true })).button);
  check("and the seat rejoins", await run(gm, P.awaitIn, { fid, actorId: lead.id, present: true }));
  const back = await run(gm, P.attached, { actorId: lead.id });
  check("the join leaves the mount as it found it", back.on === mounted.on, back);

  section("what the table saw");
  await sleep(600);
  const posted = await run(gm, P.cards, { since, words: watch });
  for (const card of posted) cards.push(gm.track(card.id, "ChatMessage"));
  note("cards", posted.map((c) => c.text));
  check("every move was announced and no refusal was", posted.length >= 7 && !posted.some((c) => /Stranger|Taken/.test(c.text)), posted.length);

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
  try { if (open.player && held.fid) await run(open.player, P.takeNotes); } catch (_e) { /* closed */ }
  try { if (open.gm && held.fid) note("the party's combat flag", await run(open.gm, P.setCombat, { fid: held.fid, value: null })); } catch (err) { console.error("combat:", err?.message ?? err); }
  try { if (open.gm && cards.length) note("cards swept", await open.gm.sweepTracked({ only: cards })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
