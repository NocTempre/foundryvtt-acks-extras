/**
 * Live walk: docs/formation/TESTING.md "A player's own actors, in and out",
 * the walk of a Player seat changing the line-up during a real fight, on the
 * fixtures of "A combat's takeover" and "A party in a combat". A fight the
 * party token deployed into is on, and the Player seat, from its party sheet:
 * takes its own deployed member out (the member leaves the record, their token
 * stays where it stood, their combatant keeps it, no token is made beside the
 * party token, and an initiative roll completes); brings in an owned actor
 * whose token is on the map (recorded deployed in this fight, token kept);
 * leaves that member behind and goes back for them (`left` flips each way, one
 * public line each time, no whisper); and presses Form up, which the Judge's
 * client answers `inCombat` and writes nothing for. The Judge then drops a
 * summoned creature's token, its summoner a member, on the party sheet: it is
 * refused with the summon-in-combat warning, its token stays and the roster is
 * as it was. The fight's end then
 * gathers the members, the one brought in included, and leaves the taken-out
 * member's token on the map outside the party. No load error lands on either
 * seat under a recorder added before reload.
 *
 * Every fixture and figure is invented. Fixtures, kept and found again by marker
 * (`api.fixture`): the scene `formation/combat-scene`; the party
 * `formation/combat-party` with its token `formation/combat-party-token` and the
 * members `formation/combat-member-2` and `-3`; and the Player seat's own
 * `formation/fight-member-player`, the member it takes out, and
 * `formation/fight-joiner`, in no party; and the creature copy
 * `formation/fight-summon-copy`, whose token the Judge drops. A shared member's ownership is never
 * changed. The walk brings them to its start
 * shape itself: no fight in the record, the three members in order and not
 * deployed, the party token shown, the joiner's token on the map.
 * Writes outside the ledger: the fight, its combat, the joiner's token, the
 * summoned creature's token (a copy's token a stopped run left is re-tracked), the
 * token the taken-out member leaves on the map, a joiner token a stopped run
 * left standing (re-tracked at the start; a member's token found standing
 * blocks the walk instead, since the members are shared fixtures), one saved
 * marching order, and the cards the relay posts, each tracked or forgotten by
 * id and swept in the finally.
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

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__flBoot = { phase: "load", phases: [], errors: [] });
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
    boot: globalThis.__flBoot ?? null,
  }),

  install: async () => {
    const H = (globalThis.__fl = globalThis.__fl ?? {});
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
    H.deployment = await import(`${base}formation/deployment.mjs`);
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.ids = (fid) => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    return { ok: typeof H.requests.requestPartyAction === "function" && typeof H.deployment.recallMembers === "function" };
  },

  formationOf: async ({ partyId }) => {
    const H = globalThis.__fl;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** Ownership of an actor set to the seat's OWNER, where it is not already. */
  grant: async ({ actorId, userId }) => {
    const actor = game.actors.get(actorId);
    if (actor.ownership?.[userId] !== 3) await actor.update({ [`ownership.${userId}`]: 3 });
    return { owner: actor.ownership?.[userId] };
  },

  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    return { scene: canvas.scene?.id === sceneId };
  },

  /** The party's linked token on the scene, made where none stands there, and adopted. */
  partyToken: async ({ fid, partyId, sceneId, x, y }) => {
    const H = globalThis.__fl;
    const scene = game.scenes.get(sceneId);
    let token = H.model.getFormation(fid).tokenId ? scene.tokens.get(H.model.getFormation(fid).tokenId) : null;
    let made = null;
    if (!token) {
      const doc = await game.actors.get(partyId).getTokenDocument({ x, y });
      [token] = await scene.createEmbeddedDocuments("Token", [{ ...doc.toObject(), actorLink: true, hidden: false }]);
      made = token.uuid;
      await H.poll(() => H.model.getFormation(fid).tokenId === token.id, { tries: 60, every: 200 });
    }
    return { tokenId: H.model.getFormation(fid).tokenId, made };
  },

  /**
   * The walk's start shape: no fight in the record, the members in the party in
   * order and out of the map, nobody else in it, the party token shown. A member
   * a stopped run left deployed is recalled through the model; one out of the
   * party leaves with `restore: false`, so no token is made. Tokens of the walk's
   * own actors still standing are listed as `strays`, for the walk to track.
   */
  startShape: async ({ fid, sceneId, wanted, own }) => {
    const H = globalThis.__fl;
    const scene = game.scenes.get(sceneId);
    await H.model.patchFormation(fid, (rec) => void (rec.combat = null));
    let f = H.model.getFormation(fid);
    const deployed = f.members.filter((m) => m?.deployedTokenId || m?.deployedStack);
    if (deployed.length) await H.deployment.recallMembers(f, { members: deployed });
    for (const id of H.ids(fid)) {
      if (!wanted.includes(id)) await H.model.removeMember(H.model.getFormation(fid), id, { restore: false });
    }
    for (const id of wanted) {
      if (!H.ids(fid).includes(id)) await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), null, { scene: null });
    }
    await H.model.patchFormation(fid, (rec) => {
      rec.members.sort((a, b) => wanted.indexOf(a?.actorId) - wanted.indexOf(b?.actorId));
      for (const m of rec.members) delete m.left;
    });
    f = H.model.getFormation(fid);
    const token = H.model.getPartyToken(f);
    if (token?.hidden) await token.update({ hidden: false });
    await H.sleep(600);
    const strays = scene.tokens.filter((t) => own.includes(t.actorId)).map((t) => ({ uuid: t.uuid, actorId: t.actorId }));
    return { members: H.ids(fid), strays, partyShown: !H.model.getPartyToken(H.model.getFormation(fid))?.hidden, combat: H.model.getFormation(fid).combat ?? null, combats: game.combats.size };
  },

  /** A token of the actor on the scene, made where none stands there. */
  ensureToken: async ({ sceneId, actorId, x, y }) => {
    const scene = game.scenes.get(sceneId);
    const have = scene.tokens.find((t) => t.actorId === actorId);
    if (have) return { uuid: have.uuid, made: false };
    const doc = await game.actors.get(actorId).getTokenDocument({ x, y });
    const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
    return { uuid: made.uuid, made: true };
  },

  newCombat: async ({ sceneId }) => {
    const c = await Combat.create({ scene: sceneId, active: false });
    await globalThis.__fl.sleep(500);
    return { id: c.id, uuid: c.uuid };
  },

  /** Press the combat toggle on the party token's HUD, with the run's own combat the tracker's viewed one. */
  hudCombat: async ({ tokenId, combatId }) => {
    const H = globalThis.__fl;
    const before = new Set(game.combats.map((c) => c.id));
    const own = game.combats.get(combatId);
    if (!own) return { toggle: false, made: [], viewed: false };
    ui.combat.viewed = own;
    if (game.combats.viewed?.id !== own.id) return { toggle: false, made: [], viewed: false };
    try { ui.controls.activate({ control: "tokens", tool: "select" }); } catch (_e) { /* active */ }
    const placeable = canvas.tokens.get(tokenId);
    placeable.control({ releaseOthers: true });
    await H.sleep(300);
    await canvas.hud.token.bind(placeable);
    await H.sleep(400);
    const toggle = document.querySelector('#token-hud [data-action="combat"]');
    toggle?.click();
    await H.sleep(4000);
    try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
    return { toggle: !!toggle, made: game.combats.filter((c) => !before.has(c.id)).map((c) => c.uuid), viewed: true };
  },

  /** The fight's state as the record and the map hold it, for the actors named. */
  read: async ({ fid, sceneId, combatId, actorIds }) => {
    const H = globalThis.__fl;
    const f = H.model.getFormation(fid);
    const scene = game.scenes.get(sceneId);
    const combat = combatId ? game.combats.get(combatId) : null;
    return {
      active: !!f.combat?.active,
      combatId: f.combat?.combatId ?? null,
      partyShown: !H.model.getPartyToken(f)?.hidden,
      order: H.ids(fid),
      members: Object.fromEntries(actorIds.map((id) => {
        const m = f.members.find((x) => x?.actorId === id);
        return [id, m ? { in: true, left: !!m.left, tokenId: m.deployedTokenId ?? null, sceneId: m.deployedSceneId ?? null, combatId: m.deployedCombatId ?? null, stashed: !!m.tokenData } : { in: false }];
      })),
      tokens: Object.fromEntries(actorIds.map((id) => [id, scene.tokens.filter((t) => t.actorId === id).map((t) => ({ id: t.id, uuid: t.uuid }))])),
      combat: combat ? combat.combatants.map((c) => ({ id: c.id, tokenId: c.tokenId, actorId: c.actorId, resolves: !!c.token, initiative: c.initiative ?? null })) : null,
    };
  },

  /** The system's own roll for the combat's blank initiatives; a throw is reported, not raised. */
  roll: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    const ids = [...combat.combatants].filter((c) => c.initiative == null).map((c) => c.id);
    try {
      if (ids.length) await combat.rollInitiative(ids);
      await globalThis.__fl.sleep(800);
      return { rolled: ids.length, initiatives: [...combat.combatants].map((c) => c.initiative ?? null) };
    } catch (err) { return { rolled: 0, threw: String(err?.message ?? err) }; }
  },

  endCombat: async ({ combatId }) => {
    const c = game.combats.get(combatId);
    if (c) await c.delete();
    await globalThis.__fl.sleep(3500);
    return { gone: !game.combats.get(combatId) };
  },

  /** The party sheet as this seat gets it, on the Order tab. */
  open: async ({ partyId }) => {
    const H = globalThis.__fl;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    await H.sleep(900);
    H.root(app)?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    await H.sleep(300);
    return { rendered: !!H.root(app), editable: !!app.isEditable };
  },

  close: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return { closed: true };
  },

  access: async ({ partyId }) => ({ owns: !!game.actors.get(partyId)?.testUserPermission(game.user, "OWNER") }),

  /** What the open Order tab shows: the list's buttons and hint, and a member's leave control. */
  sheet: async ({ partyId, actorId }) => {
    const H = globalThis.__fl;
    const el = H.root(game.actors.get(partyId).sheet);
    const section = el?.querySelector(".acks-extras-formation-bring-in");
    const control = el?.querySelector(`li.member[data-actor-id="${actorId}"] [data-action="removeMember"]`);
    return {
      listed: [...(section?.querySelectorAll('[data-action="bringIn"]') ?? [])].map((b) => ({ id: b.dataset.actorId, disabled: b.disabled })),
      hint: section?.querySelector(".hint")?.textContent ?? null,
      leave: control ? { disabled: control.disabled } : null,
    };
  },

  /** A press on the open sheet, as a click. */
  press: async ({ partyId, selector, settle = 2500 }) => {
    const H = globalThis.__fl;
    const control = H.root(game.actors.get(partyId).sheet)?.querySelector(selector);
    if (!control) return { found: false, selector };
    const disabled = !!control.disabled;
    control.click();
    await H.sleep(settle);
    return { found: true, disabled };
  },

  /** Poll for the roster to read as expected, on this seat. */
  awaitIn: async ({ fid, actorId, present }) => {
    const H = globalThis.__fl;
    return !!(await H.poll(() => H.ids(fid).includes(actorId) === present, { tries: 60, every: 200 }));
  },

  /** Poll for a member's `left` to read as given. */
  awaitLeft: async ({ fid, actorId, left }) => {
    const H = globalThis.__fl;
    return !!(await H.poll(() => {
      const m = H.model.getFormation(fid).members.find((x) => x?.actorId === actorId);
      return !!m && !!m.left === left;
    }, { tries: 60, every: 200 }));
  },

  /** A request as a client could send it; the answer the Judge's client gives comes back. */
  relay: async ({ fid, type, payload }) => {
    const H = globalThis.__fl;
    const answer = await H.requests.requestPartyAction(fid, type, payload);
    await H.sleep(1500);
    return { answer: answer ?? null };
  },

  /** Save the party's order under a name; returns the saved id. */
  saveOrder: async ({ fid, name }) => {
    const H = globalThis.__fl;
    const saved = await H.marching.saveTemplate(H.model.getFormation(fid), name);
    return { id: saved?.template?.id ?? null, order: H.ids(fid) };
  },

  forget: async ({ id }) => ({ forgotten: await globalThis.__fl.marching.deleteTemplate(id) }),

  /** Cards since `since` that name any of `words`, with whether each is a whisper. */
  cards: async ({ since, words }) => game.messages.contents
    .filter((m) => m.timestamp >= since && words.some((w) => (m.content ?? "").includes(w)))
    .map((m) => ({ id: m.id, whisper: (m.whisper ?? []).length > 0, text: (m.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() })),

  /** An unlinked token of the creature copy, stamped as a summoning of `summonerId` stamps it, by the module's own builder. */
  summonToken: async ({ sceneId, copyId, summonerId, x, y }) => {
    const logic = await import("/modules/acks-extras/scripts/lib/summons-logic.mjs");
    const scene = game.scenes.get(sceneId);
    const copy = game.actors.get(copyId);
    const flags = logic.summonFlags(`Actor.${summonerId}`, { sourceUuid: copy.getFlag("acks-extras", "summonCopy")?.sourceUuid, name: copy.name, castId: "qaFightDrop", at: game.time.worldTime });
    const doc = await copy.getTokenDocument({ x, y, actorLink: false, hidden: false, delta: { flags } }, { parent: scene });
    const data = doc.toObject();
    delete data._id;
    const [made] = await scene.createEmbeddedDocuments("Token", [data]);
    return { uuid: made.uuid, id: made.id };
  },

  /**
   * The Judge's drop of a token on the open party sheet, as the browser sends it.
   * Answers the warnings shown, the warning a summon-in-combat refusal words,
   * and the roster (every member's ids, a summon's base included) before and after.
   */
  judgeDrop: async ({ fid, partyId, tokenUuid, copyId }) => {
    const H = globalThis.__fl;
    const roster = () => JSON.stringify(H.model.getFormation(fid).members.map((m) => m ? [m.actorId ?? null, m.baseActorId ?? null] : null));
    const before = roster();
    const warns = [];
    const warn = ui.notifications.warn;
    ui.notifications.warn = (msg, ...rest) => { warns.push(String(msg)); return warn.call(ui.notifications, msg, ...rest); };
    try {
      const el = H.root(game.actors.get(partyId).sheet);
      const dt = new DataTransfer();
      dt.setData("text/plain", JSON.stringify({ type: "Token", uuid: tokenUuid }));
      el.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await H.sleep(2000);
    } finally { ui.notifications.warn = warn; }
    const expected = game.i18n.format("ACKS-FORMATION.warn.summonInCombat", { name: game.actors.get(copyId)?.name ?? "", party: H.model.getFormation(fid).name });
    return { warns, expected, before, after: roster(), standing: !!(await fromUuid(tokenUuid)) };
  },

  /** A request line with its name filled in, as the relay words it. */
  line: async ({ key, name }) => game.i18n.format(`ACKS-FORMATION.request.${key}`, { name }),

  /** The fight and its flag put down: the run's own combat ended, and the record's fight cleared. */
  stopFight: async ({ fid, combatId }) => {
    const H = globalThis.__fl;
    const c = combatId ? game.combats.get(combatId) : null;
    if (c) await c.delete();
    await H.sleep(2500);
    if (H.model.getFormation(fid)?.combat) await H.model.patchFormation(fid, (rec) => void (rec.combat = null));
    return { combat: H.model.getFormation(fid)?.combat ?? null };
  },

  boot: async () => globalThis.__flBoot ?? null,
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
const tracked = [];
const held = { fid: null, partyId: null, combatId: null, templateId: null };
const character = (name, extra = {}) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 8, max: 8 } }, ...extra });
const unique = (list) => list.filter((u, i, a) => u && a.indexOf(u) === i);

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
  check("the GM seat is the active GM, and the player seat is a Player", census.gm.activeGMIsSelf && census.player.role === 1, { gm: census.gm.role, player: census.player.role });
  if (!census.gm.activeGMIsSelf) blocked("another client is the active GM; the relay would run there");
  for (const [key, c] of Object.entries(census)) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }

  section("fixtures");
  const scene = await gm.fixture("formation/combat-scene", "Scene", { name: "QA Combat Ground", active: false, navigation: false, width: 1600, height: 1000, padding: 0, grid: { type: 1, size: 100, distance: 5, units: "ft" }, ownership: { default: 2 } });
  const party = await gm.fixture("formation/combat-party", "Actor", { name: "QA Combat Party", type: `${SCOPE}.party` });
  const yours = { ownership: { default: 0, [census.player.userId]: 3 } };
  const playerMember = await gm.fixture("formation/fight-member-player", "Actor", character("QA Fight Lead", yours));
  const members = [playerMember];
  for (const n of [2, 3]) members.push(await gm.fixture(`formation/combat-member-${n}`, "Actor", character(`QA Fighter ${n}`)));
  const joiner = await gm.fixture("formation/fight-joiner", "Actor", character("QA Joiner", yours));
  const summonCopy = await gm.fixture("formation/fight-summon-copy", "Actor", { name: "QA Fight Hound", type: "monster", system: { hp: { value: 4, max: 4 } }, flags: { [SCOPE]: { summonCopy: { sourceUuid: "Actor.qaFightHoundSource" } } } });
  const [leaver, stayer, third] = members;
  held.partyId = party.id;
  await run(gm, P.grant, { actorId: leaver.id, userId: census.player.userId });
  await run(gm, P.grant, { actorId: joiner.id, userId: census.player.userId });
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  held.fid = fid;
  check("the GM seat views the combat scene", (await run(gm, P.view, { sceneId: scene.id })).scene);
  const pt = await run(gm, P.partyToken, { fid, partyId: party.id, sceneId: scene.id, x: 500, y: 400 });
  if (pt.made) await gm.mark(pt.made, "formation/combat-party-token");
  const wanted = members.map((m) => m.id);
  const own = [...wanted, joiner.id, summonCopy.id];
  const shape = await run(gm, P.startShape, { fid, sceneId: scene.id, wanted, own });
  note("start shape", shape);
  // Only the joiner, the Player seat's member and the creature copy are this walk's alone; a member's token standing is a shared fixture's, and is reported, never swept.
  const memberStrays = shape.strays.filter((t) => t.actorId !== joiner.id && t.actorId !== playerMember.id && t.actorId !== summonCopy.id);
  if (memberStrays.length) blocked(`tokens of the combat members stand on the scene, left by an earlier run: ${memberStrays.map((t) => t.uuid).join(", ")}`);
  for (const stray of shape.strays) tracked.push(gm.track(stray.uuid, "Token"));
  check("the walk starts with the three members in order, no fight in the record, the party token shown", JSON.stringify(shape.members) === JSON.stringify(wanted) && !shape.combat && shape.partyShown, shape);
  const joinerToken = await run(gm, P.ensureToken, { sceneId: scene.id, actorId: joiner.id, x: 900, y: 700 });
  tracked.push(gm.track(joinerToken.uuid, "Token"));
  const t0 = await run(gm, P.nowMs);
  const names = ["QA Fight Lead", "QA Fighter 2", "QA Fighter 3", "QA Joiner"];
  const seen = { fid, sceneId: scene.id, actorIds: own };

  section("1. start the combat so the party deploys");
  const first = await run(gm, P.newCombat, { sceneId: scene.id });
  tracked.push(gm.track(first.uuid, "Combat"));
  held.combatId = first.id;
  const hud = await run(gm, P.hudCombat, { tokenId: pt.tokenId, combatId: first.id });
  for (const u of hud.made) tracked.push(gm.track(u, "Combat"));
  let r = await run(gm, P.read, { ...seen, combatId: first.id });
  note("deployed", { active: r.active, members: r.members, combatants: r.combat?.length });
  check("the HUD's toggle deploys the party: the fight is on, every member deployed in it, a combatant for each body", hud.toggle && hud.viewed && r.active && r.combatId === first.id && wanted.every((id) => r.members[id].tokenId && r.members[id].combatId === first.id) && r.combat?.length === 3 && !r.partyShown, { toggle: hud.toggle, viewed: hud.viewed, active: r.active });
  const leaverBody = r.members[leaver.id].tokenId;
  const leaverBodyUuid = `Scene.${scene.id}.Token.${leaverBody}`;
  tracked.push(gm.track(leaverBodyUuid, "Token"));

  section("2. the Player seat takes its deployed member out");
  let access = await run(player, P.access, { partyId: party.id });
  for (let n = 0; n < 15 && !access.owns; n++) { await sleep(300); access = await run(player, P.access, { partyId: party.id }); }
  check("the party is the seat's own through the member it owns", access.owns, access);
  await run(player, P.close, { partyId: party.id });
  const opened = await run(player, P.open, { partyId: party.id });
  check("the party sheet opens live on the Order tab", opened.rendered && opened.editable, opened);
  let sheet = await run(player, P.sheet, { partyId: party.id, actorId: leaver.id });
  note("Order tab in the fight", sheet);
  check("the list and the leave control are live, under the ordinary hint", sheet.listed.some((b) => b.id === joiner.id && !b.disabled) && !!sheet.leave && !sheet.leave.disabled && /Your people who are in no party/.test(sheet.hint ?? ""), sheet);
  const before = await run(gm, P.read, { ...seen, combatId: first.id });
  await run(player, P.press, { partyId: party.id, selector: `li.member[data-actor-id="${leaver.id}"] [data-action="removeMember"]` });
  check("the press takes the member out of the record", await run(gm, P.awaitIn, { fid, actorId: leaver.id, present: false }));
  await sleep(800);
  r = await run(gm, P.read, { ...seen, combatId: first.id });
  note("after take-out", { members: r.members[leaver.id], tokens: r.tokens[leaver.id], combat: r.combat });
  check("their deployed token stays where it stood, and no token appears beside the party token", r.tokens[leaver.id].length === 1 && r.tokens[leaver.id][0].id === leaverBody && JSON.stringify(r.tokens[leaver.id]) === JSON.stringify(before.tokens[leaver.id]), r.tokens[leaver.id]);
  check("their combatant keeps its token", r.combat?.some((c) => c.tokenId === leaverBody && c.resolves), r.combat);
  const rolled = await run(gm, P.roll, { combatId: first.id });
  note("initiative roll", rolled);
  check("an initiative roll completes: nothing thrown, every combatant holds a figure", !rolled.threw && rolled.initiatives.length === 2 && rolled.initiatives.every((i) => i != null), rolled);

  section("3. the Player seat brings in an owned actor whose token is on the map");
  sheet = await run(player, P.sheet, { partyId: party.id, actorId: joiner.id });
  check("the joiner is on the list again after the take-out redraw", sheet.listed.some((b) => b.id === joiner.id), sheet.listed);
  await run(player, P.press, { partyId: party.id, selector: `[data-action="bringIn"][data-actor-id="${joiner.id}"]` });
  check("the press brings the joiner into the record", await run(gm, P.awaitIn, { fid, actorId: joiner.id, present: true }));
  await sleep(800);
  r = await run(gm, P.read, { ...seen, combatId: first.id });
  note("after bring-in", { member: r.members[joiner.id], tokens: r.tokens[joiner.id] });
  check("the joiner is recorded deployed in this fight, as the token and the scene it stands on", r.members[joiner.id].in && r.members[joiner.id].combatId === first.id && r.members[joiner.id].tokenId === r.tokens[joiner.id][0]?.id && r.members[joiner.id].sceneId === scene.id, r.members[joiner.id]);
  check("and its token is still on the map", r.tokens[joiner.id].length === 1, r.tokens[joiner.id]);

  section("4. leave behind, then go back for, the owned member");
  await run(player, P.close, { partyId: party.id });
  await run(player, P.open, { partyId: party.id });
  const lines = { left: await run(gm, P.line, { key: "leftBehind", name: joiner.name }), back: await run(gm, P.line, { key: "wentBackFor", name: joiner.name }) };
  let since = await run(gm, P.nowMs);
  const toggle = `li.member[data-actor-id="${joiner.id}"] a[data-action="toggleLeftBehind"]`;
  let pressed = await run(player, P.press, { partyId: party.id, selector: toggle, settle: 3000 });
  check("the control is on the joiner's row", pressed.found, pressed);
  check("the decision is recorded during the fight: left is true", await run(gm, P.awaitLeft, { fid, actorId: joiner.id, left: true }));
  let posted = await run(gm, P.cards, { since, words: ["QA Joiner"] });
  for (const c of posted) tracked.push(gm.track(c.id, "ChatMessage"));
  check("with one public line and no whisper", posted.filter((c) => !c.whisper && c.text.includes(lines.left)).length === 1 && !posted.some((c) => c.whisper), posted.map((c) => ({ whisper: c.whisper, text: c.text })));
  r = await run(gm, P.read, { ...seen, combatId: first.id });
  check("the canvas is left alone: the joiner's token stands", r.tokens[joiner.id].length === 1, r.tokens[joiner.id]);
  since = await run(gm, P.nowMs);
  pressed = await run(player, P.press, { partyId: party.id, selector: toggle, settle: 3000 });
  check("going back flips it again: left is false", await run(gm, P.awaitLeft, { fid, actorId: joiner.id, left: false }));
  posted = await run(gm, P.cards, { since, words: ["QA Joiner"] });
  for (const c of posted) tracked.push(gm.track(c.id, "ChatMessage"));
  check("with one public line and no whisper", posted.filter((c) => !c.whisper && c.text.includes(lines.back)).length === 1 && !posted.some((c) => c.whisper), posted.map((c) => ({ whisper: c.whisper, text: c.text })));

  section("Form up is refused while the fight is on");
  const saved = await run(gm, P.saveOrder, { fid, name: "QA Fight Order" });
  held.templateId = saved.id;
  check("the Judge's saved order exists", !!saved.id, saved);
  const orderBefore = saved.order;
  since = await run(gm, P.nowMs);
  const formed = await run(player, P.relay, { fid, type: "formUp", payload: { templateId: saved.id } });
  note("answer", formed);
  check("the answer is { ok: false, refused: \"inCombat\" }", formed.answer?.ok === false && formed.answer?.refused === "inCombat", formed);
  r = await run(gm, P.read, { ...seen, combatId: first.id });
  posted = await run(gm, P.cards, { since, words: ["forms up in", "QA Fight Order"] });
  for (const c of posted) tracked.push(gm.track(c.id, "ChatMessage"));
  check("and nothing is written: the order stands and no card announces it", JSON.stringify(r.order) === JSON.stringify(orderBefore) && !posted.length, { before: orderBefore, after: r.order, cards: posted.length });

  section("a summoned creature dropped on the party in the fight is refused");
  const hound = await run(gm, P.summonToken, { sceneId: scene.id, copyId: summonCopy.id, summonerId: stayer.id, x: 1200, y: 700 });
  tracked.push(gm.track(hound.uuid, "Token"));
  await run(gm, P.close, { partyId: party.id });
  const judgeSheet = await run(gm, P.open, { partyId: party.id });
  check("the Judge's party sheet is open", judgeSheet.rendered, judgeSheet);
  const dropped = await run(gm, P.judgeDrop, { fid, partyId: party.id, tokenUuid: hound.uuid, copyId: summonCopy.id });
  note("drop", dropped);
  check("the drop is refused with the summon-in-combat warning", dropped.warns.includes(dropped.expected), { warns: dropped.warns });
  check("its token stands and the roster is as it was", dropped.standing && dropped.after === dropped.before, { standing: dropped.standing });
  await run(gm, P.close, { partyId: party.id });

  section("5. end the combat");
  await run(player, P.close, { partyId: party.id });
  const ended = await run(gm, P.endCombat, { combatId: first.id });
  r = await run(gm, P.read, { ...seen, combatId: null });
  note("after the end", { active: r.active, members: r.members, tokens: r.tokens });
  check("the combat is gone and the fight is off in the record, the party token shown", ended.gone && !r.active && r.partyShown, { gone: ended.gone, active: r.active, shown: r.partyShown });
  check("reform gathers the members, the one brought in included: none deployed, each stashed, none standing on the map", [stayer.id, third.id, joiner.id].every((id) => r.members[id].in && !r.members[id].tokenId && r.members[id].stashed && r.tokens[id].length === 0), { members: r.members, tokens: r.tokens });
  check("the token of the one taken out stays on the map, outside the party", !r.members[leaver.id].in && r.tokens[leaver.id].length === 1 && r.tokens[leaver.id][0].id === leaverBody, { member: r.members[leaver.id], tokens: r.tokens[leaver.id] });

  section("what the table saw");
  const all = await run(gm, P.cards, { since: t0, words: names });
  for (const c of all) tracked.push(gm.track(c.id, "ChatMessage"));
  note("cards", all.map((c) => ({ whisper: c.whisper, text: c.text })));
  check("the take-out, the bring-in and the two left-behind lines were each announced in public, and nothing naming them was whispered", all.filter((c) => !c.whisper).length >= 4 && !all.some((c) => c.whisper), all.length);

  section("errors after ready");
  for (const [key, api] of Object.entries(open)) {
    const boot = await run(api, P.boot);
    check(`${key} seat: nothing thrown over the walk`, !boot?.errors.length, boot?.errors);
  }
  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try { if (open.player && held.partyId) await run(open.player, P.close, { partyId: held.partyId }); } catch (_e) { /* closed */ }
  try { if (open.gm && held.fid) note("the fight put down", await run(open.gm, P.stopFight, { fid: held.fid, combatId: held.combatId })); } catch (err) { console.error("fight:", err?.message ?? err); }
  try { if (open.gm && held.templateId) note("saved order forgotten", await run(open.gm, P.forget, { id: held.templateId })); } catch (err) { console.error("forget:", err?.message ?? err); }
  try { if (open.gm && tracked.length) note("swept", await open.gm.sweepTracked({ only: unique(tracked) })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
