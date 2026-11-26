/**
 * Live walk, location-prune-keyed: the world-start clean-up of empty places
 * keeps a place keyed with things. Walks docs/scene-search/TESTING.md, "The
 * keyed place and the clean-up", on the GM seat: a place holding one thing and
 * nothing else (no token, no scene or Region link, no items, no notes) is not
 * among what `pruneEmptyLocations` would take, while a bare place built by
 * this run is, by contents. Where this seat is the primary GM and the world's
 * setting is on, the seat's recorded reload is the ready sweep's real trigger,
 * and both places must be standing after it: the keyed one for its contents,
 * the bare one because it was made since the world was launched, which the
 * sweep spares. Elsewhere the prune is run dry in page context only, and the
 * log says which of the two ran. The prune is never run for real from here: it
 * sweeps every empty place in the world, a peer's included. A place made
 * before the launch being swept is covered offline (test-location-prune-age);
 * this walk cannot launch the world. Machine values arrive through ./_env.mjs.
 *
 * Fixtures: `scene-search/prune-keyed`, kept and found by marker, a location
 * whose things list is brought to one fixture thing at the step's start; and a
 * bare location built with `api.create` every run and swept by its uuid.
 * The keyed place stays for the next run, even the run that built it.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";

/** Added to every document the seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__lpkBoot = { phase: "load", phases: [], errors: [] });
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
    role: game.user.role,
    primary: game.users.activeGM?.isSelf ?? false,
    activeGM: game.users.activeGM?.name ?? null,
    setting: game.settings.get("acks-extras", "pruneEmptyLocations"),
    served: (await (await fetch("/modules/acks-extras/scripts/location/module.mjs", { cache: "no-store" })).text()).includes("thingsOf(a).length > 0") && (await (await fetch("/modules/acks-extras/scripts/location/module.mjs", { cache: "no-store" })).text()).includes("sparedByAge"),
  }),

  /** The keyed place brought to one thing and nothing else that keeps a place. */
  key: async ({ id }) => {
    const PT = await import("/modules/acks-extras/scripts/lib/place-things.mjs");
    const place = game.actors.get(id);
    await place.unsetFlag("acks-extras", PT.THINGS_FLAG);
    await PT.addThingTo(place, { kind: "fixture", ref: null, layers: {} });
    return {
      things: PT.thingsOf(place).length,
      items: place.items.size,
      roster: (place.system?.roster ?? []).length,
      tokens: game.scenes.contents.reduce((n, s) => n + s.tokens.filter((t) => t.actorId === id).length, 0),
      notes: !!(place.system?.notes || "").replace(/<[^>]*>/g, "").trim() || !!(place.system?.gmNotes || "").replace(/<[^>]*>/g, "").trim(),
    };
  },

  /** What the prune, run dry, would take of the two places. Writes nothing. */
  dry: async ({ keyed, bare }) => {
    const LM = await import("/modules/acks-extras/scripts/location/module.mjs");
    const { doomed } = await LM.pruneEmptyLocations({ dryRun: true });
    return { keyed: doomed.includes(keyed), bare: doomed.includes(bare), count: doomed.length };
  },

  /** Whether the place was made since the world was launched, by the server's two stamps. */
  age: async ({ uuid }) => {
    const launch = Date.parse(game.world?.lastPlayed ?? "");
    const created = fromUuidSync(uuid)?._stats?.createdTime;
    return { lastPlayed: game.world?.lastPlayed ?? null, launch, created, sinceLaunch: Number.isFinite(launch) && typeof created === "number" && created >= launch };
  },

  /** Resolves once the primary GM election has settled on this seat, which is what starts the ready sweep. */
  settled: async () => {
    const util = await import("/modules/acks-extras/scripts/lib/util.mjs");
    return await Promise.race([util.primaryGMSettled(), new Promise((r) => setTimeout(() => r(null), 60000))]);
  },

  exists: async ({ uuids }) => Object.fromEntries(uuids.map((u) => [u, !!fromUuidSync(u)])),
  boot: async () => globalThis.__lpkBoot ?? null,
};

async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.location`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Reload the seat's page under the load recorder, held by a second DevTools session until the page is ready. */
async function reloadRecorded(api) {
  const targets = await (await fetch(`http://127.0.0.1:${PORTS.gm}/json/list`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(MACHINE.origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next;
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
  const seconds = await ready(api, "gm");
  ws.close();
  return seconds;
}

let gm = null;
let bareUuid = null;
try {
  section("seat");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("ready after (s)", await ready(gm, "gm"));

  section("load recorder");
  note("recorded reload ready after (s)", await reloadRecorded(gm));
  const census = await run(gm, P.census);
  note("census", census);
  if (census.role !== 4) throw new Error("the GM seat is not a gamemaster");
  check("the served location module carries the things guard and the age guard", census.served);

  section("fixtures");
  const keyed = await gm.fixture("scene-search/prune-keyed", "Actor", { name: "Prune Walk Keyed Place", type: LOCATION });
  note("keyed fixture", { uuid: keyed.uuid, built: keyed.built });
  const bare = await gm.create("Actor", { name: "Prune Walk Bare Place", type: LOCATION });
  bareUuid = bare.uuid;
  note("bare place", bare.uuid);
  const shape = await run(gm, P.key, { id: keyed.id });
  check("the keyed place holds one thing and nothing else that keeps a place", shape.things === 1 && shape.items === 0 && shape.roster === 0 && shape.tokens === 0 && !shape.notes, shape);

  section("the prune, run dry in page context");
  const dry = await run(gm, P.dry, { keyed: keyed.uuid, bare: bare.uuid });
  note("dry", dry);
  check("run dry, the prune spares the keyed place", !dry.keyed, dry);
  check("run dry, the prune would take the bare place by its contents", dry.bare, dry);

  section("the ready sweep's real trigger: the primary GM's ready");
  const age = await run(gm, P.age, { uuid: bare.uuid });
  note("bare place's age against the world's launch", age);
  check("the bare place was made since the world was launched", age.sinceLaunch, age);
  if (census.primary && census.setting) {
    note("trigger", "this seat is the primary GM and the setting is on: the recorded reload runs the ready sweep");
    await reloadRecorded(gm);
    // The sweep starts when the primary GM election settles and deletes one place at a time, so a delete has
    // no fixed arrival: the walk waits for the settle, then a bounded interval past it, and logs both.
    const t1 = Date.now();
    note("election settled on this seat", await run(gm, P.settled));
    note("settled after (s)", Math.round((Date.now() - t1) / 1000));
    await sleep(15000);
    const after = await run(gm, P.exists, { uuids: [keyed.uuid, bare.uuid] });
    check("after the primary GM's ready, the keyed place stands", after[keyed.uuid], after);
    check("after the primary GM's ready, the bare place, made since launch, stands", after[bare.uuid], after);
  } else {
    note("trigger", `NOT RUN: primary=${census.primary} (active GM: ${census.activeGM}), setting=${census.setting}; page-context dry run only`);
  }

  section("console");
  const boot = await run(gm, P.boot);
  check("the recorder saw init, setup and ready and no error from load to the walk's end", boot && ["init", "setup", "ready"].every((x) => boot.phases.includes(x)) && boot.errors.length === 0, boot && { phases: boot.phases, errors: boot.errors });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { if (bareUuid) note("sweep", await gm.sweepTracked({ only: [bareUuid] })); } catch (err) { console.error("sweep failed:", err?.message ?? err); }
    try { await gm.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
