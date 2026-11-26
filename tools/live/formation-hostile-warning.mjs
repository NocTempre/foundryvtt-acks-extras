/**
 * Live walk, formation-hostile-warning: the party sheet's warning for a member
 * who stands publicly hostile (docs/magic/TESTING.md "A temporary ally that
 * turns hostile leaves the party", step 6; docs/formation/MODEL.md, "A member
 * who stands publicly hostile is warned of, and nothing more"). The party's
 * members are deployed as tokens on a field, and the sheet is opened ONCE per
 * seat and never rendered or closed again between a change and its read: every
 * read polls the open sheet's DOM, so a redraw that happens is one the sheet's
 * own hooks made.
 *   1. Baseline: with the Judge's hireling friendly and unhidden, neither seat's
 *      sheet carries the hostile-member line.
 *   2. The Judge sets the hireling's token Hostile (a document update stands in
 *      for the token configuration's Disposition control): the line naming the
 *      hireling, and no one else, appears on the Judge's seat and on the Player
 *      seat, and the roster is as it was.
 *   3. The token is hidden: the line goes on both seats; shown again: it returns.
 *   4. Each seat views a second scene: the line goes; each views the field
 *      again: it returns.
 *   5. The token is set friendly again: the line goes.
 *   6. FINDING, not a check: a monster member whose prototype disposition is
 *      hostile, deployed and touched by nothing else. The walk prints the
 *      token's disposition and hidden state and whether either seat's sheet
 *      names it.
 * No console error or uncaught error lands on either seat over the walk (the
 * recorders attach after `ready`, so this says nothing of `init`, `setup` or
 * `ready`). Prints booleans and counts; the ledger's sweep is the one place ids
 * print. Not covered: a second Player seat that owns no member of the party
 * (the machine has one Player seat), the token configuration's own Disposition
 * control (an update stands in), and the recipe's re-add of a hostile creature.
 *
 * Fixtures, kept and found by marker (the GM seat builds what is missing):
 * `formation/hostile-scene` (the field), `formation/hostile-scene-other` (the
 * second scene, observable by default), `formation/hostile-party` (an
 * `acks-extras.party` actor), `formation/hostile-party-token` (its token on the
 * field), `formation/hostile-own` (a character the Player owns),
 * `formation/hostile-hireling` (a character the Judge holds, prototype token
 * friendly), `formation/hostile-monster` (a monster whose prototype token is
 * hostile). The walk brings the party to its start shape itself: the first two
 * as members, deployed, the monster not a member. Teardown recalls what it
 * deployed through the party's own recall, removes the monster from the party
 * and sweeps its own tracked tokens alone.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCOPE = "acks-extras";
const KEY = "formation-hostile-warning-walk";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const skip = (label, reason) => console.log(`SKIP  ${label}  ${reason}`);
const finding = (label, detail) => console.log(`FINDING  ${label}  ${JSON.stringify(detail)}`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

const HIRELING_NAME = "QA Hostile Hireling";
const OWN_NAME = "QA Hostile Own Member";
const MONSTER_NAME = "QA Hostile Monster";
const LINE_KEY = "ACKS-FORMATION.warnings.hostileMember";

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__fhw = globalThis.__fhw ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      H.onRejection = (e) => H.uncaught.push("rejection: " + String(e.reason?.message ?? e.reason ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    const rows = await import("/modules/acks-extras/scripts/equipment/weapon-rows.mjs");
    await Promise.race([rows.rowsReady(), H.sleep(60000)]);
    const base = "/modules/acks-extras/scripts/";
    H.model = await import(`${base}formation/formation-model.mjs`);
    H.dep = await import(`${base}formation/deployment.mjs`);
    await H.sleep(300);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, paused: game.paused, formationApi: typeof globalThis.acksExtras?.formation?.travel?.setJourneyMode === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  loc: async ({ key, data }) => game.i18n.format(key, data ?? {}),
  drain: async () => {
    const H = globalThis.__fhw;
    const out = { errors: H.errors.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  /** View a scene without activating it, and wait for its canvas. */
  view: async ({ sceneId }) => {
    const scene = game.scenes.get(sceneId);
    if (!scene) return { ok: false, viewed: null };
    if (canvas.scene?.id !== sceneId) await scene.view();
    const stop = Date.now() + 25000;
    while (Date.now() < stop && !(canvas.ready && canvas.scene?.id === sceneId)) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 800));
    return { ok: canvas.scene?.id === sceneId, viewed: game.scenes.viewed?.id === sceneId };
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    return true;
  },
  /** The record behind a party actor, once its create hook has made one; a hand-made actor no record names is adopted. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__fhw;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 40, every: 200 });
    if (found) return { fid: found.id, adopted: false };
    const made = await H.model.adoptPartyActor(game.actors.get(partyId));
    return { fid: made.id, adopted: true };
  },
  /**
   * The party's start shape: nothing deployed (a run stopped mid-way leaves members out, and they are recalled through the party's own recall), the
   * monster not a member, the two people members with no token of their own, a party token on the field, the party delving.
   */
  formParty: async ({ fid, sceneId, ownId, hirelingId, monsterId, tokenMarker }) => {
    const H = globalThis.__fhw;
    const scene = game.scenes.get(sceneId);
    const get = () => H.model.getFormation(fid);
    const out = {};
    const stranded = get().members.filter((m) => m?.actorId && H.dep.isMemberDeployed(m));
    out.recalled = stranded.length;
    if (stranded.length) await H.dep.recallMembers(get(), { members: stranded });
    out.monsterWasMember = get().members.some((m) => m?.actorId === monsterId);
    if (out.monsterWasMember) await H.model.removeMembers(get(), [monsterId], { restore: false });
    for (const id of [ownId, hirelingId]) {
      if (!get().members.some((m) => m?.actorId === id)) await H.model.addMember(get(), game.actors.get(id), null, { scene: null });
    }
    if (!H.model.getPartyToken(get())) await H.model.ensurePartyToken(get(), scene, 300, 300);
    const mode = get().travel?.mode;
    if (mode && mode !== "delve") await globalThis.acksExtras.formation.travel.setJourneyMode(fid, "delve");
    await H.sleep(500);
    const f = get();
    const token = H.model.getPartyToken(f);
    return {
      ...out,
      partyTokenUuid: token?.uuid ?? null,
      markedToken: !!token && token.flags?.world?.fixture === tokenMarker,
      onScene: f.sceneId === sceneId,
      hasOwn: f.members.some((m) => m?.actorId === ownId),
      hasHireling: f.members.some((m) => m?.actorId === hirelingId),
      hasMonster: f.members.some((m) => m?.actorId === monsterId),
      deployed: f.members.filter((m) => m?.actorId && H.dep.isMemberDeployed(m)).length,
      delving: (f.travel?.mode ?? "delve") === "delve",
    };
  },
  /** Whether this seat owns the party actor and a member of the party. */
  owns: async ({ partyId, ownId }) => ({ party: !!game.actors.get(partyId)?.isOwner, member: !!game.actors.get(ownId)?.isOwner }),
  /** The roster as the record holds it: member ids in order. */
  roster: async ({ fid }) => globalThis.__fhw.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId),
  /** Send the named members out through the party's own deployment; answers each one's token. */
  deploy: async ({ fid, actorIds }) => {
    const H = globalThis.__fhw;
    const f = H.model.getFormation(fid);
    const members = f.members.filter((m) => m?.actorId && actorIds.includes(m.actorId));
    await H.dep.deployMembers(f, { members });
    const after = H.model.getFormation(fid);
    const scene = game.scenes.get(after.sceneId);
    return Object.fromEntries(actorIds.map((id) => {
      const m = after.members.find((x) => x?.actorId === id);
      const token = m?.deployedTokenId ? scene?.tokens.get(m.deployedTokenId) : null;
      return [id, { tokenId: token?.id ?? null, uuid: token?.uuid ?? null, sceneId: scene?.id ?? null }];
    }));
  },
  /** One token as the scene holds it. */
  tokenState: async ({ sceneId, tokenId }) => {
    const t = game.scenes.get(sceneId)?.tokens.get(tokenId);
    return t ? { exists: true, disposition: t.disposition, hostile: t.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE, hidden: !!t.hidden } : { exists: false };
  },
  /** One token's update, as a configuration's save writes it (no animation), then the token as the scene holds it. */
  tokenSet: async ({ sceneId, tokenId, changes }) => {
    const t = game.scenes.get(sceneId)?.tokens.get(tokenId);
    if (!t) return { exists: false };
    await t.update(changes, { animate: false });
    await new Promise((r) => setTimeout(r, 300));
    return { exists: true, disposition: t.disposition, hostile: t.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE, hidden: !!t.hidden };
  },
  /** Open the party sheet on this seat once. It is never rendered or closed again by the walk until teardown. */
  openSheet: async ({ partyId }) => {
    const H = globalThis.__fhw;
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    const el = await H.poll(() => (H.root(app)?.isConnected ? H.root(app) : null), { tries: 60, every: 200 });
    await H.sleep(800);
    return { rendered: !!el };
  },
  /** The open sheet's warning lines as its DOM holds them now; no render is made. */
  lines: async ({ partyId }) => {
    const H = globalThis.__fhw;
    const app = game.actors.get(partyId).sheet;
    const root = app.rendered ? H.root(app) : null;
    return { open: !!root, lines: root ? [...root.querySelectorAll("section.warnings p")].map((p) => p.textContent.replace(/\s+/g, " ").trim()) : [], viewed: game.scenes.viewed?.id ?? null };
  },
  /** Poll the open sheet's DOM until `line` is present (or absent); no render is made. Answers whether it settled and how long it took. */
  awaitLine: async ({ partyId, line, present, tries = 70, every = 150 }) => {
    const H = globalThis.__fhw;
    const app = game.actors.get(partyId).sheet;
    const t0 = Date.now();
    for (let n = 0; n < tries; n++) {
      const root = app.rendered ? H.root(app) : null;
      const lines = root ? [...root.querySelectorAll("section.warnings p")].map((p) => p.textContent.replace(/\s+/g, " ").trim()) : [];
      if (root && lines.includes(line) === present) return { ok: true, ms: Date.now() - t0, open: true, count: lines.length };
      await H.sleep(every);
    }
    const root = app.rendered ? H.root(app) : null;
    const lines = root ? [...root.querySelectorAll("section.warnings p")].map((p) => p.textContent.replace(/\s+/g, " ").trim()) : [];
    return { ok: false, ms: Date.now() - t0, open: !!root, count: lines.length, hostileLines: lines.filter((l) => l.startsWith(line.split(":")[0])).length };
  },
  closeSheet: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch { /* not open */ }
    return true;
  },
  /** Bring the party to rest: everything out is recalled through the party's own recall, the monster leaves the roster. */
  settle: async ({ fid, monsterId }) => {
    const H = globalThis.__fhw;
    const get = () => H.model.getFormation(fid);
    const out = get().members.filter((m) => m?.actorId && H.dep.isMemberDeployed(m));
    if (out.length) await H.dep.recallMembers(get(), { members: out });
    const monster = get().members.some((m) => m?.actorId === monsterId);
    if (monster) await H.model.removeMembers(get(), [monsterId], { restore: false });
    return { recalled: out.length, monsterRemoved: monster };
  },
  restore: async () => {
    const H = globalThis.__fhw;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    window.removeEventListener("error", H.onError);
    window.removeEventListener("unhandledrejection", H.onRejection);
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

async function ready(api, label, { seconds = 240 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** One step of the walk in its own try: a throw is a failed check and the next step still runs. */
async function step(label, fn) {
  try { await fn(); } catch (err) { check(`${label}: the step ran to its end`, false, String(err?.message ?? err).slice(0, 240)); }
}

let gm = null;
let player = null;
let fid = null;
let partyId = null;
let monsterId = null;
/** The uuids of what this run made: the only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 600_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install, { key: KEY });
  const seated = await run(player, P.install, { key: KEY });
  check("the GM seat is the active GM and the player seat is a player, both with the party's travel API", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2 && installed.formationApi && seated.formationApi, { gm: installed.role, player: seated.role });
  if (!installed.activeGMIsSelf) blocked("another client is the active GM");

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const marker = (m) => (MACHINE.own ? `${m}@${MACHINE.own}` : m);
  const character = (name, ownership) => ({ name, type: "character", prototypeToken: { actorLink: true, disposition: 1 }, system: { hp: { value: 6, max: 6 } }, ...(ownership ? { ownership } : {}) });
  const field = { active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55", grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, environment: { globalLight: { enabled: true } }, ownership: { default: 2 } };
  const scene = await gm.fixture("formation/hostile-scene", "Scene", { name: "QA Hostile Field", ...field });
  const sceneOther = await gm.fixture("formation/hostile-scene-other", "Scene", { name: "QA Hostile Other Field", ...field });
  const party = await gm.fixture("formation/hostile-party", "Actor", { name: "QA Hostile Party", type: `${SCOPE}.party` });
  const ownMember = await gm.fixture("formation/hostile-own", "Actor", character(OWN_NAME, { default: 0, [playerId]: 3 }));
  const hireling = await gm.fixture("formation/hostile-hireling", "Actor", character(HIRELING_NAME, { default: 0 }));
  const monster = await gm.fixture("formation/hostile-monster", "Actor", { name: MONSTER_NAME, type: "monster", prototypeToken: { actorLink: false, disposition: -1 }, system: { hp: { value: 6, max: 6 } }, ownership: { default: 0 } });
  const sceneId = idOf(scene);
  const otherId = idOf(sceneOther);
  partyId = idOf(party);
  const ownId = idOf(ownMember);
  const hirelingId = idOf(hireling);
  monsterId = idOf(monster);

  const formed = await run(gm, P.formationOf, { partyId });
  fid = formed.fid;
  note("the party's record was adopted for its actor", formed.adopted);
  const shape = await run(gm, P.formParty, { fid, sceneId, ownId, hirelingId, monsterId, tokenMarker: marker("formation/hostile-party-token") });
  if (shape.partyTokenUuid && !shape.markedToken) await gm.mark(shape.partyTokenUuid, "formation/hostile-party-token");
  note("party start shape", { recalled: shape.recalled, monsterWasMember: shape.monsterWasMember, deployed: shape.deployed });
  check("start shape: the two people are members, the monster is not, the party token stands on the field and nothing is deployed", shape.hasOwn && shape.hasHireling && !shape.hasMonster && !!shape.partyTokenUuid && shape.onScene && shape.deployed === 0 && shape.delving, shape);
  let owns = await run(player, P.owns, { partyId, ownId });
  for (let n = 0; n < 20 && !owns.party; n++) { await sleep(300); owns = await run(player, P.owns, { partyId, ownId }); }
  check("the Player seat owns a member and, through it, the party actor, so it can open the sheet", owns.member && owns.party, owns);
  if (!owns.party) blocked("the Player seat cannot open the party sheet");
  check("the GM seat views the field", (await run(gm, P.view, { sceneId })).ok);
  check("the Player seat views the field without activating it", (await run(player, P.view, { sceneId })).ok);

  const out = await run(gm, P.deploy, { fid, actorIds: [ownId, hirelingId] });
  const hTok = out[hirelingId];
  const oTok = out[ownId];
  if (hTok?.uuid) await track(hTok.uuid, "Token");
  if (oTok?.uuid) await track(oTok.uuid, "Token");
  check("start shape: both people are deployed as tokens on the field", !!hTok?.tokenId && !!oTok?.tokenId && hTok.sceneId === sceneId, { hireling: !!hTok?.tokenId, own: !!oTok?.tokenId });
  // The kept stash may carry the last run's disposition: both tokens are written to the shape the walk starts from, and read back.
  for (const t of [hTok, oTok]) await run(gm, P.tokenSet, { sceneId, tokenId: t.tokenId, changes: { disposition: 1, hidden: false } });
  const h0 = await run(gm, P.tokenState, { sceneId, tokenId: hTok.tokenId });
  const o0 = await run(gm, P.tokenState, { sceneId, tokenId: oTok.tokenId });
  check("start shape: both tokens read friendly and unhidden", h0.exists && !h0.hostile && !h0.hidden && o0.exists && !o0.hostile && !o0.hidden, { hireling: h0, own: o0 });
  const rosterBefore = await run(gm, P.roster, { fid });

  const line = (seat, names) => run(seat, P.loc, { key: LINE_KEY, data: { names } });
  const hireLine = await line(gm, HIRELING_NAME);
  const hireLinePlayer = await line(player, HIRELING_NAME);
  check("the hostile-member line reads the same on both seats and names the hireling", hireLine === hireLinePlayer && hireLine.includes(HIRELING_NAME), { same: hireLine === hireLinePlayer });
  /** Poll each seat's open sheet for the line, present or absent. */
  const both = async (text, present) => {
    const g = await run(gm, P.awaitLine, { partyId, line: text, present });
    const p = await run(player, P.awaitLine, { partyId, line: text, present });
    return { gm: g, player: p };
  };
  const settle = (r) => r.gm.ok && r.player.ok && r.gm.open && r.player.open;

  // Each seat opens its sheet once. From here to teardown the walk reads the sheets' DOM and never renders or closes one.
  const openedGm = await run(gm, P.openSheet, { partyId });
  const openedPlayer = await run(player, P.openSheet, { partyId });
  check("the party sheet is open on the Judge's seat and on the Player seat", openedGm.rendered && openedPlayer.rendered, { gm: openedGm.rendered, player: openedPlayer.rendered });
  await run(gm, P.drain);
  await run(player, P.drain);

  section("1. baseline: no hostile member, no line");
  await step("1", async () => {
    const r = await both(hireLine, false);
    check("1: neither seat's sheet carries the hostile-member line while the hireling is friendly", settle(r), { gm: r.gm, player: r.player });
  });

  section("2. the hireling's token is set Hostile: the line names it on both seats, and the roster is as it was");
  await step("2", async () => {
    const set = await run(gm, P.tokenSet, { sceneId, tokenId: hTok.tokenId, changes: { disposition: -1 } });
    check("2: the write landed: the token reads hostile and unhidden", set.hostile && !set.hidden, set);
    const r = await both(hireLine, true);
    check("2: the line naming the hireling appears on the open sheet of the Judge's seat and of the Player seat, with no render made by the walk", settle(r), { gm: r.gm, player: r.player });
    const roster = await run(gm, P.roster, { fid });
    check("2: the roster is unchanged: the same members in the same order", JSON.stringify(roster) === JSON.stringify(rosterBefore), { before: rosterBefore.length, after: roster.length });
  });

  section("3. hidden: the line goes on both seats; shown again, it returns");
  await step("3", async () => {
    const hid = await run(gm, P.tokenSet, { sceneId, tokenId: hTok.tokenId, changes: { hidden: true } });
    check("3: the write landed: the token reads hidden and still hostile", hid.hidden && hid.hostile, hid);
    const gone = await both(hireLine, false);
    check("3: with the hostile token hidden the line is gone from both seats' open sheets", settle(gone), { gm: gone.gm, player: gone.player });
    const shown = await run(gm, P.tokenSet, { sceneId, tokenId: hTok.tokenId, changes: { hidden: false } });
    check("3: the write landed: the token reads unhidden and hostile", !shown.hidden && shown.hostile, shown);
    const back = await both(hireLine, true);
    check("3: unhidden, the line returns on both seats", settle(back), { gm: back.gm, player: back.player });
  });

  section("4. the viewed scene: the line goes on another scene, and returns on the field");
  await step("4", async () => {
    const vg = await run(gm, P.view, { sceneId: otherId });
    const vp = await run(player, P.view, { sceneId: otherId });
    check("4: each seat views the second scene", vg.ok && vp.ok && vg.viewed && vp.viewed, { gm: vg, player: vp });
    const gone = await both(hireLine, false);
    check("4: on the second scene the line is gone from both seats' open sheets (no render made by the walk)", settle(gone), { gm: gone.gm, player: gone.player });
    const bg = await run(gm, P.view, { sceneId });
    const bp = await run(player, P.view, { sceneId });
    check("4: each seat views the field again", bg.ok && bp.ok && bg.viewed && bp.viewed, { gm: bg, player: bp });
    const back = await both(hireLine, true);
    check("4: back on the field the line returns on both seats", settle(back), { gm: back.gm, player: back.player });
  });

  section("5. the token is set friendly again: the line goes");
  await step("5", async () => {
    const set = await run(gm, P.tokenSet, { sceneId, tokenId: hTok.tokenId, changes: { disposition: 1 } });
    check("5: the write landed: the token reads friendly", !set.hostile, set);
    const r = await both(hireLine, false);
    check("5: the line is gone from both seats' open sheets", settle(r), { gm: r.gm, player: r.player });
  });

  section("6. FINDING: a monster member whose prototype disposition is hostile, deployed and touched by nothing else");
  await step("6", async () => {
    const added = await run(gm, async ({ fid: id, monsterId: mid }) => {
      const H = globalThis.__fhw;
      if (!H.model.getFormation(id).members.some((m) => m?.actorId === mid)) await H.model.addMember(H.model.getFormation(id), game.actors.get(mid), null, { scene: null });
      return H.model.getFormation(id).members.some((m) => m?.actorId === mid);
    }, { fid, monsterId });
    if (!added) { skip("6: the monster finding", "the party refused the monster as a member"); return; }
    const deployed = await run(gm, P.deploy, { fid, actorIds: [monsterId] });
    const mTok = deployed[monsterId];
    if (mTok?.uuid) await track(mTok.uuid, "Token");
    if (!mTok?.tokenId) { skip("6: the monster finding", "the monster could not be deployed as a token"); return; }
    const state = await run(gm, P.tokenState, { sceneId, tokenId: mTok.tokenId });
    const monsterLine = await line(gm, MONSTER_NAME);
    const monsterLinePlayer = await line(player, MONSTER_NAME);
    // Both seats are polled for the line up to the same window: a sheet that never redraws after the deploy reads as absent, so the verdict is the sheet's, as the seat draws it.
    const g = await run(gm, P.awaitLine, { partyId, line: monsterLine, present: true, tries: 50, every: 200 });
    const p = await run(player, P.awaitLine, { partyId, line: monsterLinePlayer, present: true, tries: 50, every: 200 });
    note("6: the deployed monster token's disposition (hostile is -1) and hidden state", { disposition: state.disposition, hidden: state.hidden });
    finding("a monster member deployed with a hostile prototype disposition " + (g.ok || p.ok ? "RAISES" : "does not raise") + " the hostile-member warning with nothing else touched", { tokenHostile: state.hostile, tokenHidden: state.hidden, judgeSeatShowsLine: g.ok, playerSeatShowsLine: p.ok });
  });

  section("errors after ready");
  const dg = await run(gm, P.drain);
  const dp = await run(player, P.drain);
  check("no console error or uncaught error on the GM seat over the walk", !dg.errors.length && !dg.uncaught.length, { errors: dg.errors.length, uncaught: dg.uncaught.length });
  check("no console error or uncaught error on the Player seat over the walk", !dp.errors.length && !dp.uncaught.length, { errors: dp.errors.length, uncaught: dp.uncaught.length });
  skip("a second Player seat that owns nothing in the party sees the same line", "the machine has one Player seat");
  walkDone();
} catch (err) {
  if (err instanceof WalkBlocked) note("walk blocked", err.message);
  else {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  try { if (player && partyId) await run(player, P.closeSheet, { partyId }); } catch (err) { console.error("close player sheet:", err?.message ?? err); }
  try { if (gm && partyId) await run(gm, P.closeSheet, { partyId }); } catch (err) { console.error("close gm sheet:", err?.message ?? err); }
  // What the run deployed goes back into the party through its own recall, and the monster leaves the roster; the tracked tokens the recall already deleted sweep as could-not-find.
  try { if (gm && fid) note("party settled", await run(gm, P.settle, { fid, monsterId })); } catch (err) { console.error("settle:", err?.message ?? err); }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: formation/hostile-scene, formation/hostile-scene-other, formation/hostile-party, formation/hostile-party-token, formation/hostile-own, formation/hostile-hireling, formation/hostile-monster");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`checks: ${passed} passed, ${checks.length - passed} failed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
