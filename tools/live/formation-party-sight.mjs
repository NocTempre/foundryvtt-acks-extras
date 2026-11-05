/**
 * Live walk, a party actor made from the sidebar: docs/formation/TESTING.md,
 * "A party actor made from the sidebar", steps 1-4. Setup is the subject, so
 * the party is built fresh with the sidebar's own write (a name and a type),
 * its token placed on the kept column scene, and both tracked and swept.
 * Machine values arrive through ./_env.mjs; nothing here names a port, a
 * world, a seat or a book.
 *
 * Fixtures: `formation/column-scene`, found by marker (the column walk builds
 * it; this walk only places a token on it). Built and swept: the party actor
 * and its token, by the ids the run reads back. Writes outside the ledger: the
 * formation the actor's createActor hook adopts, dissolved by the deleteActor
 * hook when the sweep removes the actor; the walk reads that it is gone.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const MOD = "acks-extras";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({
    module: game.modules.get("acks-extras")?.version ?? null,
    role: game.user.role,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    manageVision: (() => { try { return game.settings.get("acks-extras", "manageVision"); } catch { return null; } })(),
  }),

  /** The sidebar's Create Actor: a name and a type, nothing else. */
  create: async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const errors = [];
    const prior = console.error;
    console.error = (...args) => { errors.push(args.map((a) => String(a?.message ?? a)).join(" ").slice(0, 200)); prior.apply(console, args); };
    let actor = null;
    let f = null;
    try {
      actor = await Actor.create({ name: "PS Sidebar Party", type: "acks-extras.party" });
      const formations = () => Object.values(acksExtras.formation.getFormations());
      for (let i = 0; i < 150 && !(f = formations().find((r) => r.actorId === actor.id)); i++) await sleep(100);
    } finally {
      console.error = prior;
    }
    return {
      uuid: actor?.uuid,
      id: actor?.id,
      sight: actor?.prototypeToken.sight.enabled,
      formationId: f?.id ?? null,
      flagged: !!actor?.getFlag("acks-extras", "formationId"),
      errors: errors.filter((e) => e.includes("acks-extras")),
    };
  },

  /** Place the actor's token and wait for the adoption and the first sync. */
  place: async ({ actorId, sceneId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const actor = game.actors.get(actorId);
    const scene = game.scenes.get(sceneId);
    const doc = await actor.getTokenDocument({ x: 100, y: 1200 });
    const [token] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
    const formation = () => Object.values(game.settings.get("acks-extras", "formations") ?? {}).find((r) => r.actorId === actorId);
    for (let i = 0; i < 50 && formation()?.tokenId !== token.id; i++) await sleep(100);
    for (let i = 0; i < 50 && !token.getFlag("acks-extras", "partySight"); i++) await sleep(100);
    return { uuid: token.uuid, id: token.id, adopted: formation()?.tokenId === token.id, sight: token.sight.enabled, stamped: token.getFlag("acks-extras", "partySight") === true };
  },

  /** A formation change the primary GM syncs on. */
  touch: async ({ formationId, name }) => {
    const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    await model.patchFormation(formationId, (rec) => void (rec.name = name));
  },

  /** Step 3: a token as it stood before the fix, then a sync. */
  unread: async ({ formationId, sceneId, tokenId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const token = game.scenes.get(sceneId).tokens.get(tokenId);
    await token.update({ "sight.enabled": false });
    await token.unsetFlag("acks-extras", "partySight");
    await token.unsetFlag("acks-extras", "managedVision");
    const before = { sight: token.sight.enabled, stamped: !!token.getFlag("acks-extras", "partySight"), claimed: !!token.getFlag("acks-extras", "managedVision") };
    const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    await model.patchFormation(formationId, (rec) => void (rec.name = "PS Sidebar Party 2"));
    for (let i = 0; i < 50 && !token.sight.enabled; i++) await sleep(100);
    return { before, sight: token.sight.enabled, stamped: token.getFlag("acks-extras", "partySight") === true };
  },

  /** Step 4: a Judge's sight-off, then a sync. */
  blind: async ({ formationId, sceneId, tokenId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const token = game.scenes.get(sceneId).tokens.get(tokenId);
    await token.update({ "sight.enabled": false });
    const model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    await model.patchFormation(formationId, (rec) => void (rec.name = "PS Sidebar Party 3"));
    await sleep(3000);
    return { sight: token.sight.enabled };
  },

  formationGone: async ({ actorId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const has = () => Object.values(game.settings.get("acks-extras", "formations") ?? {}).some((r) => r.actorId === actorId);
    for (let i = 0; i < 50 && has(); i++) await sleep(100);
    return !has();
  },
};

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`gm: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let actorId = null;
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm));
  // Every step here waits on a hook the primary GM's window runs, and a window
  // still joining its seat's election answers false to that test.
  const primary = await run(gm, async () => {
    const util = await import("/modules/acks-extras/scripts/lib/util.mjs");
    return await Promise.race([util.primaryGMSettled(), new Promise((r) => setTimeout(() => r(null), 30000))]);
  });
  const census = await run(gm, P.census);
  note("census", { ...census, primary });
  check("the GM seat is the active GM and this window runs its automation", census.activeGMIsSelf && census.role === 4 && primary === true, { ...census, primary });
  if (primary !== true) throw new Error("this window is not the primary GM");

  section("fixtures");
  // Found and never built here: the column walk owns its shape.
  const scene = await run(gm, async () => {
    const hits = game.scenes.filter((s) => s.flags?.world?.fixture === "formation/column-scene");
    return hits.length === 1 ? { id: hits[0].id } : { count: hits.length };
  });
  if (!scene.id) throw new Error(`formation/column-scene found ${scene.count} times: run the formation-column walk first`);
  note("scene", "formation/column-scene found");

  section("1. the sidebar's creation");
  const made = await run(gm, P.create);
  gm.track(made.uuid, "Actor");
  actorId = made.id;
  note("made", { sight: made.sight, formation: !!made.formationId, flagged: made.flagged, errors: made.errors });
  check("a party actor made with only a name and a type has a seeing prototype", made.sight === true);
  check("its createActor hook adopts it into a formation", !!made.formationId);

  section("2. its token");
  const placed = await run(gm, P.place, { actorId: made.id, sceneId: scene.id });
  gm.track(placed.uuid, "Token");
  note("placed", placed);
  check("the placed token is adopted, sees, and carries the party-sight stamp", placed.adopted && placed.sight === true && placed.stamped, placed);

  section("3. a token placed before the fix");
  const mended = await run(gm, P.unread, { formationId: made.formationId, sceneId: scene.id, tokenId: placed.id });
  note("mended", mended);
  check("an unstamped, unclaimed party token with sight off is switched on at the next sync, and stamped", !mended.before.sight && !mended.before.stamped && !mended.before.claimed && mended.sight === true && mended.stamped, mended);

  section("4. a Judge's choice");
  const blinded = await run(gm, P.blind, { formationId: made.formationId, sceneId: scene.id, tokenId: placed.id });
  note("blinded", blinded);
  check("sight a hand turns off after the stamp stays off through a sync", blinded.sight === false, blinded);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (gm) {
    try {
      const swept = await gm.sweepTracked();
      note("swept", swept);
      if (actorId) check("the swept actor's formation is dissolved", await run(gm, P.formationGone, { actorId }));
    } catch (err) { console.error("sweep:", err?.message ?? err); }
    note("ledger (gm)", "");
    try { await gm.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
