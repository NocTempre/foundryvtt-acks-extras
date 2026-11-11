/**
 * Live walk, the mapper's hands: docs/formation/TESTING.md, "The mapper is
 * vulnerable". A party's mapper carries the system's Vulnerable condition while
 * it holds the role, through a fight while surprised, until its own turn in the
 * first round it is not surprised, and again once the combat ends; a death or
 * the role set down takes it off, and a Vulnerable a hand set is never touched.
 * A boot recorder attached before the reload sees `init`, `setup` and `ready`.
 * Prints booleans and counts, never a name. Machine values arrive through
 * ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them): a scene
 * `formation/mapper-scene`; two characters, `formation/mapper` and
 * `formation/mapper-foe`, each with a linked token on it
 * (`formation/mapper-token`, `formation/mapper-foe-token`); and the party
 * `formation/mapper-party`, whose formation holds the mapper as its only member
 * (the walk adds them when the record lacks them). Built and swept by the run's
 * own ledger: the combats and their combatants, and any status effect the walk
 * or an earlier unfinished run left on the mapper.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SCENE = "formation/mapper-scene";
const MAPPER = "formation/mapper";
const FOE = "formation/mapper-foe";
const MAPPER_TOKEN = "formation/mapper-token";
const FOE_TOKEN = "formation/mapper-foe-token";
const PARTY = "formation/mapper-party";
const KEY = "formation-mapper-vulnerable-walk";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Runs before any of Foundry's scripts on the next document load: records warnings and errors from `init` on. */
const BOOT_RECORDER = `(() => {
  if (window.top !== window) return;
  const B = (window.__boot = { preFoundry: typeof globalThis.Hooks === "undefined" && typeof globalThis.game === "undefined", warn: [], error: [] });
  const text = (args) => args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300);
  for (const level of ["warn", "error"]) {
    const original = console[level];
    console[level] = (...args) => { B[level].push(text(args)); return original.apply(console, args); };
  }
  window.addEventListener("error", (e) => B.error.push("uncaught: " + String(e.message ?? "").slice(0, 200)));
})();`;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__mk = globalThis.__mk ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 200 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.model = () => import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    H.formation = (actorId) => Object.values(acksExtras.formation.getFormations()).find((f) => f.actorId === actorId) ?? null;
    /** The effects on the mapper that bear on the walk, as booleans and counts. */
    H.read = ({ mapperId, tokenId, sceneId }) => {
      const actor = game.actors.get(mapperId);
      const mine = [...actor.effects].filter((e) => e.getFlag("acks-extras", "heldCondition") === "mapperKit");
      const vuln = [...actor.effects].filter((e) => e.statuses.has("vulnerable"));
      const token = game.scenes.get(sceneId)?.tokens.get(tokenId);
      return {
        marked: mine.length,
        fixedId: mine.length === 1 && mine[0].id === "heldMapperKit001",
        markedHasStatus: mine.every((e) => e.statuses.has("vulnerable")),
        unmarked: vuln.filter((e) => !e.getFlag("acks-extras", "heldCondition")).length,
        actorStatus: actor.statuses.has("vulnerable"),
        tokenShows: !!token?.hasStatusEffect?.("vulnerable"),
        dead: actor.statuses.has("dead"),
        surprised: actor.statuses.has("surprised"),
      };
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
    }
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      primary: await Promise.race([import("/modules/acks-extras/scripts/lib/util.mjs").then((u) => u.primaryGMSettled()), new Promise((r) => setTimeout(() => r(null), 30000))]),
    };
  },

  /** What the recorder saw across the load. */
  boot: async () => {
    const b = window.__boot ?? null;
    const own = (list) => list.filter((m) => /mapper|held-condition|heldCondition|managed effect|managedEffect|environment sync/iu.test(m)).length;
    return { recorded: !!b, preFoundry: !!b?.preFoundry, warns: b?.warn.length ?? null, errors: b?.error.length ?? null, ownWarns: b ? own(b.warn) : null, ownErrors: b ? own(b.error) : null };
  },

  /**
   * The mapper's known shape: the party's formation holds them with no role, no
   * status effect of the walk's is on them, and no combat holds them. Returns
   * the uuids of status effects an earlier run left, for the driver to track
   * and sweep.
   */
  shape: async ({ partyId, mapperId }) => {
    const H = globalThis.__mk;
    const model = await H.model();
    const found = await H.poll(() => H.formation(partyId));
    if (!found) return { formation: false };
    let formation = found;
    if (!formation.members.some((m) => m?.actorId === mapperId)) {
      formation = await model.addMember(formation, game.actors.get(mapperId), null, { scene: null });
      await H.sleep(800);
    }
    await model.patchFormation(formation.id, (rec) => { for (const m of rec.members) if (m?.actorId === mapperId) m.roles = []; });
    await H.sleep(1200);
    const actor = game.actors.get(mapperId);
    const left = [...actor.effects].filter((e) => ["vulnerable", "surprised", "dead"].some((s) => e.statuses.has(s)) || e.getFlag("acks-extras", "heldCondition")).map((e) => e.uuid);
    return { formation: true, formationId: formation.id, member: H.formation(partyId).members.some((m) => m?.actorId === mapperId), left };
  },

  read: async (args) => globalThis.__mk.read(args),

  /** Wait until the mapper holds (or does not hold) the marked effect, then a beat more so a late second write would show. */
  settle: async ({ mapperId, held, tokenId, sceneId, tries = 70 }) => {
    const H = globalThis.__mk;
    const actor = game.actors.get(mapperId);
    const has = () => [...actor.effects].some((e) => e.getFlag("acks-extras", "heldCondition") === "mapperKit");
    const matched = !!(await H.poll(() => has() === held, { tries, every: 150 }));
    await H.sleep(900);
    return { matched, ...H.read({ mapperId, tokenId, sceneId }) };
  },

  /** The party sheet's write beneath the Mapper role: the formation model's own patch. */
  role: async ({ partyId, mapperId, on }) => {
    const H = globalThis.__mk;
    const model = await H.model();
    const formation = H.formation(partyId);
    await model.patchFormation(formation.id, (rec) => { for (const m of rec.members) if (m?.actorId === mapperId) m.roles = on ? ["mapper"] : []; });
    return { roles: H.formation(partyId).members.find((m) => m?.actorId === mapperId)?.roles ?? null };
  },

  /** A formation change the primary GM syncs on, that touches no role. */
  touch: async ({ partyId, name }) => {
    const H = globalThis.__mk;
    const model = await H.model();
    await model.patchFormation(H.formation(partyId).id, (rec) => void (rec.name = name));
    return true;
  },

  /** Toggle a status on the mapper the way a token HUD does, and return the uuids of the effects carrying it. */
  status: async ({ mapperId, status, on }) => {
    const actor = game.actors.get(mapperId);
    await actor.toggleStatusEffect(status, { active: on });
    await globalThis.__mk.sleep(300);
    return [...actor.effects].filter((e) => e.statuses.has(status) && !e.getFlag("acks-extras", "heldCondition")).map((e) => e.uuid);
  },

  /** The combat holds these two as combatants with the given initiatives; returns the combatant ids by key. */
  rows: async ({ combatId, inits }) => {
    const combat = game.combats.get(combatId);
    const ids = {};
    for (const c of combat.combatants) ids[c.actorId] = c.id;
    await combat.updateEmbeddedDocuments("Combatant", Object.entries(inits).map(([actorId, initiative]) => ({ _id: ids[actorId], initiative })));
    return { order: combat.turns.map((c) => c.actorId), ids };
  },

  /** Move the tracker to `round` with `who` (a combatant id) up, as core's own turn update does. */
  turn: async ({ combatId, round, who }) => {
    const combat = game.combats.get(combatId);
    const turn = combat.turns.findIndex((c) => c.id === who);
    await combat.update({ round, turn });
    await globalThis.__mk.sleep(400);
    return { round: combat.round, up: combat.combatant?.id === who };
  },

  /** Has the combat marked this member's kit stashed? */
  stashed: async ({ combatId, mapperId }) => {
    const flag = game.combats.get(combatId)?.getFlag("acks-extras", "kitStashed");
    return { marked: !!flag?.[mapperId], marks: Object.keys(flag ?? {}).length };
  },

  /** A combat's end, by the tracker's own delete. */
  endCombat: async ({ combatId }) => {
    await game.combats.get(combatId)?.delete();
    return !game.combats.has(combatId);
  },

  drain: async () => ({ errors: globalThis.__mk.errors.slice(), uncaught: globalThis.__mk.uncaught.length }),
  restore: async () => {
    const H = globalThis.__mk;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    window.removeEventListener("error", H.onError);
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

async function ready(api, label, { seconds = 240, fresh = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Attach a second DevTools session, register the boot recorder for the next document, and reload (the driver's own session attaches after `ready`). */
async function reloadWithRecorder(api) {
  const version = await (await fetch(`http://127.0.0.1:${PORTS.gm}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const cdp = new Cdp(ws);
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page" && t.url.includes("/game"));
    if (!page) throw new Error("no /game page to reload");
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT_RECORDER }, sessionId);
    await api.eval("window.__preReload = true; 0");
    await cdp.send("Page.reload", {}, sessionId);
    const seconds = await ready(api, "gm after reload", { fresh: true });
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId).catch(() => {});
    return seconds;
  } finally {
    try { ws.close(); } catch {}
  }
}

let gm = null;
let ids = null;
const swept = [];
const RUN_START = Date.now();
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 540_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Track a document the run built or left, by uuid, so the sweep deletes exactly these. */
const track = async (uuid, kind) => { if (!swept.includes(uuid)) { swept.push(uuid); await gm.track(uuid, kind); } };

try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm));
  const installed = await run(gm, P.install, { key: KEY });
  check("the GM seat is the active GM and this window runs its automation", installed.isGM && installed.activeGMIsSelf && installed.role === 4 && installed.primary === true, installed);
  if (installed.primary !== true) throw new Error("this window is not the primary GM");
  const boot = await run(gm, P.boot);
  check("the boot recorder ran before Foundry's scripts and saw the load", boot.recorded && boot.preFoundry, { warns: boot.warns, errors: boot.errors });
  check("it saw no warning or error naming the mapper kit, the held condition or the managed-effect registration", boot.ownWarns === 0 && boot.ownErrors === 0, { ownWarns: boot.ownWarns, ownErrors: boot.ownErrors });

  section("fixtures");
  const scene = await gm.fixture(SCENE, "Scene", { name: "QA Mapper Scene", width: 1200, height: 800, grid: { size: 100 } });
  const mapper = await gm.fixture(MAPPER, "Actor", { name: "QA Mapper", type: "character" });
  const foe = await gm.fixture(FOE, "Actor", { name: "QA Mapper Foe", type: "character" });
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const mapperTok = await gm.fixture(MAPPER_TOKEN, "Token", { name: "QA Mapper", actorId: idOf(mapper), actorLink: true, x: 100, y: 300 }, { parent: scene.uuid });
  const foeTok = await gm.fixture(FOE_TOKEN, "Token", { name: "QA Mapper Foe", actorId: idOf(foe), actorLink: true, x: 300, y: 300 }, { parent: scene.uuid });
  const party = await gm.fixture(PARTY, "Actor", { name: "QA Mapper Party", type: "acks-extras.party" });
  ids = { sceneId: idOf(scene), mapperId: idOf(mapper), foeId: idOf(foe), mapperTokenId: idOf(mapperTok), foeTokenId: idOf(foeTok), partyId: idOf(party) };
  const view = { mapperId: ids.mapperId, tokenId: ids.mapperTokenId, sceneId: ids.sceneId };
  const shaped = await run(gm, P.shape, ids);
  for (const uuid of shaped.left ?? []) await track(uuid, "ActiveEffect");
  if ((shaped.left ?? []).length) note("effects an earlier run left on the mapper, tracked for the sweep", shaped.left.length);
  if (shaped.left?.length) note("swept before the walk", await gm.sweepTracked({ only: shaped.left }));
  check("the party's formation holds the mapper with no role", shaped.formation && shaped.member, { formation: shaped.formation, member: shaped.member });
  const bare = await run(gm, P.settle, { ...view, held: false });
  check("shape: no marked effect and no Vulnerable stands on the mapper", bare.marked === 0 && bare.unmarked === 0 && !bare.actorStatus, bare);

  section("1. the role held outside a fight");
  const roleOn = await run(gm, P.role, { partyId: ids.partyId, mapperId: ids.mapperId, on: true });
  check("the mapper role is on the member", roleOn.roles?.includes("mapper"), roleOn);
  const held = await run(gm, P.settle, { ...view, held: true });
  check("Vulnerable lands: one effect, under the fixed id, marked, carrying the status", held.matched && held.marked === 1 && held.fixedId && held.markedHasStatus, held);
  check("the actor and its token both show the status", held.actorStatus && held.tokenShows, { actor: held.actorStatus, token: held.tokenShows });
  await run(gm, P.touch, { partyId: ids.partyId, name: "QA Mapper Party 2" });
  const again = await run(gm, P.settle, { ...view, held: true });
  check("a later sync writes nothing new: still exactly one marked effect", again.marked === 1 && again.fixedId, again);

  section("2. a fight with the mapper surprised");
  const combat = await gm.create("Combat", { scene: ids.sceneId, active: false });
  await track(combat.uuid, "Combat");
  const mapperRow = await gm.create("Combatant", { tokenId: ids.mapperTokenId, sceneId: ids.sceneId, actorId: ids.mapperId }, { parent: combat.uuid });
  const foeRow = await gm.create("Combatant", { tokenId: ids.foeTokenId, sceneId: ids.sceneId, actorId: ids.foeId }, { parent: combat.uuid });
  const combatId = idOf(combat);
  const rows = await run(gm, P.rows, { combatId, inits: { [ids.foeId]: 15, [ids.mapperId]: 10 } });
  const mine = rows.ids[ids.mapperId];
  const theirs = rows.ids[ids.foeId];
  check("the combat holds both bodies, the foe first", Object.keys(rows.ids).length === 2 && rows.order[0] === ids.foeId, { count: Object.keys(rows.ids).length, foeFirst: rows.order[0] === ids.foeId });
  note("combatant rows built (ids tracked by the ledger)", [mapperRow, foeRow].every((r) => !!r?.uuid));
  const surprised = await run(gm, P.status, { mapperId: ids.mapperId, status: "surprised", on: true });
  for (const uuid of surprised) await track(uuid, "ActiveEffect");
  check("the mapper is surprised", surprised.length === 1);
  const r1foe = await run(gm, P.turn, { combatId, round: 1, who: theirs });
  const r1foeRead = await run(gm, P.settle, { ...view, held: true });
  check("round 1, the foe's turn: the condition holds", r1foe.up && r1foeRead.marked === 1, { up: r1foe.up, marked: r1foeRead.marked });
  const r1me = await run(gm, P.turn, { combatId, round: 1, who: mine });
  const r1meRead = await run(gm, P.settle, { ...view, held: true });
  const r1stash = await run(gm, P.stashed, { combatId, mapperId: ids.mapperId });
  check("round 1, the mapper's own turn while surprised: held, and no stash is marked", r1me.up && r1meRead.marked === 1 && !r1stash.marked, { marked: r1meRead.marked, stash: r1stash.marked });
  await run(gm, P.turn, { combatId, round: 1, who: theirs });
  const lifted = await run(gm, P.status, { mapperId: ids.mapperId, status: "surprised", on: false });
  const liftedRead = await run(gm, P.settle, { ...view, held: true });
  check("the system's surprise lifted: no longer surprised, and the condition still holds", lifted.length === 0 && !liftedRead.surprised && liftedRead.marked === 1, { surprised: liftedRead.surprised, marked: liftedRead.marked });
  const r2foe = await run(gm, P.turn, { combatId, round: 2, who: theirs });
  const r2foeRead = await run(gm, P.settle, { ...view, held: true });
  const r2foeStash = await run(gm, P.stashed, { combatId, mapperId: ids.mapperId });
  check("round 2, just before the mapper's turn: held, no stash marked", r2foe.up && r2foeRead.marked === 1 && !r2foeStash.marked, { marked: r2foeRead.marked, stash: r2foeStash.marked });
  const r2me = await run(gm, P.turn, { combatId, round: 2, who: mine });
  const r2meRead = await run(gm, P.settle, { ...view, held: false });
  const r2meStash = await run(gm, P.stashed, { combatId, mapperId: ids.mapperId });
  check("round 2, onto the mapper's own turn: the condition lifts and the stash is marked for them", r2me.up && r2meRead.matched && r2meRead.marked === 0 && !r2meRead.actorStatus && !r2meRead.tokenShows && r2meStash.marked, { marked: r2meRead.marked, stash: r2meStash.marked, token: r2meRead.tokenShows });
  await run(gm, P.turn, { combatId, round: 3, who: theirs });
  await run(gm, P.turn, { combatId, round: 3, who: mine });
  const r3Read = await run(gm, P.settle, { ...view, held: false });
  check("the hands stay free for the rest of that combat", r3Read.marked === 0 && !r3Read.actorStatus, { marked: r3Read.marked });

  section("3. the combat ends");
  check("the tracker deletes the combat", await run(gm, P.endCombat, { combatId }));
  const back = await run(gm, P.settle, { ...view, held: true });
  check("the role resumes: the condition returns, one marked effect", back.matched && back.marked === 1 && back.fixedId && back.actorStatus, back);

  section("4. a fight the mapper is not in");
  const other = await gm.create("Combat", { scene: ids.sceneId, active: false });
  await track(other.uuid, "Combat");
  const lone = await gm.create("Combatant", { tokenId: ids.foeTokenId, sceneId: ids.sceneId, actorId: ids.foeId }, { parent: other.uuid });
  const otherId = idOf(other);
  const loneRows = await run(gm, P.rows, { combatId: otherId, inits: { [ids.foeId]: 12 } });
  await run(gm, P.turn, { combatId: otherId, round: 1, who: loneRows.ids[ids.foeId] });
  await run(gm, P.turn, { combatId: otherId, round: 2, who: loneRows.ids[ids.foeId] });
  const noTurn = await run(gm, P.settle, { ...view, held: true });
  check("a mapper with no combatant never gets a turn: held through the combat", !!lone?.uuid && noTurn.marked === 1 && noTurn.actorStatus, { marked: noTurn.marked });
  check("the other combat's end leaves the condition held", (await run(gm, P.endCombat, { combatId: otherId })) && (await run(gm, P.settle, { ...view, held: true })).marked === 1);

  section("5. a death");
  const dead = await run(gm, P.status, { mapperId: ids.mapperId, status: "dead", on: true });
  for (const uuid of dead) await track(uuid, "ActiveEffect");
  const deadRead = await run(gm, P.settle, { ...view, held: false });
  check("a dead mapper is never vulnerable: the effect is gone", deadRead.matched && deadRead.marked === 0 && deadRead.dead, { marked: deadRead.marked, dead: deadRead.dead });
  const revived = await run(gm, P.status, { mapperId: ids.mapperId, status: "dead", on: false });
  const revivedRead = await run(gm, P.settle, { ...view, held: true });
  check("with the death lifted the role's condition returns", revived.length === 0 && revivedRead.matched && revivedRead.marked === 1, { marked: revivedRead.marked });

  section("6. the role set down");
  await run(gm, P.role, { partyId: ids.partyId, mapperId: ids.mapperId, on: false });
  const gone = await run(gm, P.settle, { ...view, held: false });
  check("the condition is gone, and so is the status on the actor and its token", gone.matched && gone.marked === 0 && !gone.actorStatus && !gone.tokenShows, { marked: gone.marked, actor: gone.actorStatus, token: gone.tokenShows });

  section("7. a Vulnerable a hand set");
  const hand = await run(gm, P.status, { mapperId: ids.mapperId, status: "vulnerable", on: true });
  for (const uuid of hand) await track(uuid, "ActiveEffect");
  const handRead = await run(gm, P.settle, { ...view, held: false });
  check("the hand's effect stands with no marker", handRead.unmarked === 1 && handRead.marked === 0 && handRead.actorStatus, { unmarked: handRead.unmarked, marked: handRead.marked });
  await run(gm, P.touch, { partyId: ids.partyId, name: "QA Mapper Party 3" });
  await sleep(2500);
  const handSync = await run(gm, P.read, view);
  check("a sync leaves it alone", handSync.unmarked === 1 && handSync.marked === 0, { unmarked: handSync.unmarked, marked: handSync.marked });
  await run(gm, P.role, { partyId: ids.partyId, mapperId: ids.mapperId, on: true });
  const both = await run(gm, P.settle, { ...view, held: true });
  check("with the role taken the module's effect stands beside the hand's", both.marked === 1 && both.unmarked === 1, { marked: both.marked, unmarked: both.unmarked });
  await run(gm, P.role, { partyId: ids.partyId, mapperId: ids.mapperId, on: false });
  const kept = await run(gm, P.settle, { ...view, held: false });
  check("setting the role down takes the module's effect and leaves the hand's: status still on", kept.marked === 0 && kept.unmarked === 1 && kept.actorStatus, { marked: kept.marked, unmarked: kept.unmarked });

  section("console");
  const errors = await run(gm, P.drain);
  const own = errors.errors.filter((e) => /mapper|held-condition|environment sync|stash/iu.test(e));
  check("no console error naming the mapper kit or the environment sync over the walk", own.length === 0 && errors.uncaught === 0, { own: own.length, uncaught: errors.uncaught, all: errors.errors.length });
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm) {
    try {
      // Pull the mapper back to a known shape for the next walk before the sweep: no role.
      if (ids) {
        try {
          await run(gm, P.role, { partyId: ids.partyId, mapperId: ids.mapperId, on: false });
          await run(gm, P.touch, { partyId: ids.partyId, name: "QA Mapper Party" });
        } catch { /* the walk may have died before the formation held the member */ }
      }
      note("swept (the run's own combats and the status effects it made or found)", await gm.sweepTracked({ only: swept }));
    } catch (err) { console.error("sweep:", err?.message ?? err); }
    try { note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
    console.log(`fixtures kept: ${SCENE}, ${MAPPER}, ${FOE}, ${MAPPER_TOKEN}, ${FOE_TOKEN}, ${PARTY}`);
    console.log(`run window: ${Math.round((Date.now() - RUN_START) / 1000)} s`);
    try { await gm.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
