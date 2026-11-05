/**
 * Live walk, location-notes-tab: a place's notes have a tab of their own.
 * Walks docs/location/TESTING.md step 24 on the GM and Player seats: the Notes
 * tab sits second, after Contents; pressing it shows the shared notes and, on
 * the GM seat only, the Judge's notes beneath them; neither field is left on
 * Contents or GM Settings; the shared notes' editor on the Notes tab writes the
 * field it names; and a Player seat that observes the place reads the shared
 * notes there with no editor, while its render holds neither the Judge's field
 * nor its text. The GM seat's reload is also the world-start prune's real
 * trigger, and the place, holding nothing but its notes, must survive it.
 * Machine values arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `location/notes-place`, a location the
 * Player seat observes, holding nothing, its two notes brought to this walk's
 * text at the step's start. Every figure printed is a count or a boolean.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";
const SHARED = "<p>Notes walk: the shared record.</p>";
const PRIVATE = "<p>Notes walk: the Judge's record.</p>";
const WRITTEN = "<p>Notes walk: written from the Notes tab.</p>";

/** Added to every document a seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__lntBoot = { phase: "load", phases: [], errors: [] });
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
  census: async () => ({ role: game.user.role, userId: game.user.id, module: game.modules.get("acks-extras")?.version ?? null }),

  /** The place's two notes, brought to the walk's text. */
  shape: async ({ id, notes, gmNotes }) => {
    const place = game.actors.get(id);
    await place.update({ "system.notes": notes, "system.gmNotes": gmNotes });
    return { notes: place.system.notes === notes, gmNotes: place.system.gmNotes === gmNotes };
  },

  /** Open the sheet, press its Notes tab as a user does, and read what each tab holds. */
  sheet: async ({ id, shared, secret }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(id);
    if (!place) return { visible: false };
    const app = place.sheet;
    await app.render({ force: true });
    for (let i = 0; i < 50 && !app.rendered; i++) await sleep(100);
    const root = app.element;
    const nav = [...root.querySelectorAll("nav.sheet-tabs [data-tab]")];
    const order = nav.map((a) => a.dataset.tab);
    const notesNav = nav.find((a) => a.dataset.tab === "notes");
    notesNav?.click();
    for (let i = 0; i < 30 && !root.querySelector("section[data-tab='notes']")?.classList.contains("active"); i++) await sleep(100);
    const tab = (t) => root.querySelector(`section[data-tab='${t}']`);
    const notes = tab("notes");
    const out = {
      visible: true,
      order,
      label: notesNav?.textContent.trim() ?? null,
      expectedLabel: game.i18n.localize("ACKS-HENCHMEN.location.tab.notes"),
      active: !!notes?.classList.contains("active") && app.tabGroups.primary === "notes",
      sharedEditor: !!notes?.querySelector("prose-mirror[name='system.notes']"),
      sharedText: !!notes && notes.textContent.includes(shared),
      judgeEditor: !!notes?.querySelector("prose-mirror[name='system.gmNotes']"),
      judgeText: !!notes && notes.textContent.includes(secret),
      sharedOnContents: !!tab("contents")?.querySelector("[name='system.notes']"),
      judgeOnSettings: !!tab("gmSettings")?.querySelector("[name='system.gmNotes']"),
      judgeAnywhere: !!root.querySelector("[name='system.gmNotes']") || root.innerHTML.includes(secret),
    };
    return out;
  },

  /** Write the shared notes through the Notes tab's editor, as its save does, and read the actor back. */
  write: async ({ id, html }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(id);
    const root = place.sheet.element;
    const pm = root.querySelector("section[data-tab='notes'] prose-mirror[name='system.notes']");
    if (!pm) return { editor: false };
    pm.value = html;
    pm.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 50 && place.system.notes !== html; i++) await sleep(100);
    return { editor: true, landed: place.system.notes === html, judgeKept: place.system.gmNotes != null && place.system.gmNotes !== "" };
  },

  exists: async ({ id }) => !!game.actors.get(id),

  /** Whether the world-start prune, run dry, would take the place: as it stands, then with both notes saved empty. Writes nothing but the notes, which it puts back. */
  dryPrune: async ({ id }) => {
    const LM = await import("/modules/acks-extras/scripts/location/module.mjs");
    const place = game.actors.get(id);
    const doomed = async () => (await LM.pruneEmptyLocations({ dryRun: true })).doomed.includes(place.uuid);
    const before = { notes: place.system.notes, gmNotes: place.system.gmNotes };
    const noted = await doomed();
    await place.update({ "system.notes": "<p></p>", "system.gmNotes": "<p></p>" });
    const blank = await doomed();
    await place.update({ "system.notes": before.notes, "system.gmNotes": before.gmNotes });
    return { noted, blank, restored: place.system.notes === before.notes && place.system.gmNotes === before.gmNotes };
  },

  close: async ({ id }) => {
    const app = game.actors.get(id)?.sheet;
    if (app?.rendered) await app.close({ animate: false });
    return true;
  },

  boot: async () => globalThis.__lntBoot ?? null,
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

/** Reload a seat's page under the load recorder, held by a second DevTools session until the page is ready. */
async function reloadRecorded(api, key) {
  const targets = await (await fetch(`http://127.0.0.1:${PORTS[key]}/json/list`)).json();
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
  const seconds = await ready(api, key);
  ws.close();
  return seconds;
}

const seats = {};
async function seat(key) {
  const user = key === "gm" ? MACHINE.gm : MACHINE.player;
  const api = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user, port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`ready (${key}) after (s)`, await ready(api, key));
  return api;
}

let placeId = null;
try {
  section("seats");
  const gm = await seat("gm");
  const census = await run(gm, P.census);
  note("census", census);
  if (census.role !== 4) throw new Error("the GM seat is not a gamemaster");
  const player = await seat("player");
  const pc = await run(player, P.census);
  if (pc.role >= 3) throw new Error("the player seat is not a player");

  section("fixtures");
  const place = await gm.fixture("location/notes-place", "Actor", { name: "Notes Walk Place", type: LOCATION, ownership: { default: 0, [pc.userId]: 2 } });
  placeId = place.id;
  note("fixture", { built: place.built });
  const shaped = await run(gm, P.shape, { id: place.id, notes: SHARED, gmNotes: PRIVATE });
  check("the place carries the walk's shared and private notes", shaped.notes && shaped.gmNotes, shaped);

  section("load recorder");
  note("gm recorded reload ready after (s)", await reloadRecorded(gm, "gm"));
  note("player recorded reload ready after (s)", await reloadRecorded(player, "player"));

  section("24. the world-start prune keeps a place with notes");
  // The GM seat's reload is the prune's real trigger: the primary GM's ready
  // sweeps empty locations, and the fixture holds nothing but its notes.
  await sleep(5000);
  check("the GM seat's ready left the place standing", await run(gm, P.exists, { id: place.id }));
  const dry = await run(gm, P.dryPrune, { id: place.id });
  check("run dry, the prune spares it while its notes are written and would take it once both are saved empty", !dry.noted && dry.blank && dry.restored, dry);

  const plain = (html) => html.replace(/<[^>]+>/g, "");

  section("24. the GM seat");
  const g = await run(gm, P.sheet, { id: place.id, shared: plain(SHARED), secret: plain(PRIVATE) });
  note("gm", g);
  check("the Notes tab sits second, after Contents, under its own label", g.order[0] === "contents" && g.order[1] === "notes" && g.label === g.expectedLabel && g.label !== "ACKS-HENCHMEN.location.tab.notes", { order: g.order, label: g.label });
  check("pressing it makes it the active tab", g.active);
  check("it holds the shared notes' editor and their text, and the Judge's editor and text beneath", g.sharedEditor && g.sharedText && g.judgeEditor && g.judgeText, g);
  check("neither field is left on Contents or GM Settings", !g.sharedOnContents && !g.judgeOnSettings, g);
  const w = await run(gm, P.write, { id: place.id, html: WRITTEN });
  check("the Notes tab's editor writes the shared notes, and the Judge's are untouched", w.editor && w.landed && w.judgeKept, w);
  await run(gm, P.shape, { id: place.id, notes: SHARED, gmNotes: PRIVATE });

  section("24. the Player seat");
  const p = await run(player, P.sheet, { id: place.id, shared: plain(SHARED), secret: plain(PRIVATE) });
  note("player", p);
  check("the Player seat opens the place and gets the Notes tab second", p.visible && p.order[0] === "contents" && p.order[1] === "notes" && p.active, { order: p.order, active: p.active });
  check("it reads the shared notes, with no editor for an observer", p.sharedText && !p.sharedEditor, p);
  check("its render holds neither the Judge's field nor their text", !p.judgeEditor && !p.judgeText && !p.judgeAnywhere, p);

  section("console");
  for (const [key, api] of Object.entries(seats)) {
    const boot = await run(api, P.boot);
    check(`${key}: the recorder saw init, setup and ready and no error from load to the walk's end`, boot && ["init", "setup", "ready"].every((x) => boot.phases.includes(x)) && boot.errors.length === 0, boot && { phases: boot.phases, errors: boot.errors });
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  for (const api of Object.values(seats)) {
    if (placeId) { try { await run(api, P.close, { id: placeId }); } catch {} }
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
