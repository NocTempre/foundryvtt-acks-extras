/**
 * Live walk, location-house-spoil: a spoil in a location's house pile has no
 * claim throw, and the Judge's lock releases it. Walks docs/location/TESTING.md
 * step 25 on the GM and Player seats: the Player seat's sheet of the place
 * carries no claim button and no Storage tab; a retrieval of the spoil from
 * that seat is refused while the row is locked; the GM seat's Storage tab
 * draws the spoil with the release lock and no claim button, and pressing the
 * lock marks the row retrievable; the Player seat then retrieves the spoil to
 * its own character. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `location/house-spoil`, a location the
 * Player seat observes, holding goods, and `location/house-spoil-hero`, a
 * character the Player seat owns. The place's one house row, a flagged spoil,
 * is brought back at the step's start by the flag `world.fixtureItem` carried
 * by the walk's own items on both fixtures. Every figure printed is a count or
 * a boolean. The walk builds nothing a sweep would remove: its only builds are
 * the kept fixtures.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";
/** The tag the walk's own embedded items carry, on both fixtures. */
const TAG = "location/house-spoil";

/** Added to every document a seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__lhsBoot = { phase: "load", phases: [], errors: [] });
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
    userId: game.user.id,
    module: game.modules.get("acks-extras")?.version ?? null,
    activeGM: game.users.activeGM?.id ?? null,
  }),

  /** Bring both fixtures to shape: the place holds goods and one locked house spoil, the hero carries none of the walk's items. */
  shape: async ({ placeId, heroId, tag }) => {
    const S = acksExtras.lib.storage;
    const house = acksExtras.lib.money.HOUSE_OWNER;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(heroId);
    for (const doc of [place, hero]) {
      const own = doc.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
      if (own.length) await doc.deleteEmbeddedDocuments("Item", own);
    }
    await S.setProvider(place, true);
    await S.stockProvider(place, [{ name: "House Spoil Walk Spoil", type: "item", flags: { "acks-extras": { spoil: true }, world: { fixtureItem: tag } } }], { ownerUuid: house, ownerName: "House" });
    const rows = place.items.filter((i) => i.flags?.world?.fixtureItem === tag);
    const row = rows[0];
    return {
      provider: S.isProvider(place),
      rows: rows.length,
      itemId: row?.id ?? null,
      spoil: !!row?.flags?.["acks-extras"]?.spoil,
      houseOwned: row?.flags?.["acks-extras"]?.storage?.ownerUuid === house,
      locked: !row?.flags?.["acks-extras"]?.storage?.retrievable,
      heroItems: hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
    };
  },

  /** Open the place's sheet and read what it offers: the tabs, and any claim control anywhere in it. */
  sheet: async ({ placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(placeId);
    if (!place) return { visible: false };
    const app = place.sheet;
    await app.render({ force: true });
    for (let i = 0; i < 50 && !app.rendered; i++) await sleep(100);
    const root = app.element;
    return {
      visible: true,
      isGM: game.user.isGM,
      tabs: [...root.querySelectorAll("nav.sheet-tabs [data-tab]")].map((a) => a.dataset.tab),
      claimButtons: root.querySelectorAll('[data-action="houseAttemptSpoil"]').length,
      diceGlyphs: root.querySelectorAll(".fa-dice-d20").length,
      raw: /ACKS-LOCATION\.storage\.(attemptSpoil|spoilUnlocked|spoilHeld)/.test(root.innerHTML),
      storageTab: !!root.querySelector('section[data-tab="storage"]'),
    };
  },

  /** GM: open the Storage tab and read the house group's spoil row. */
  storageRow: async ({ placeId, itemId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const app = game.actors.get(placeId).sheet;
    app.changeTab("storage", "primary");
    await sleep(400);
    const row = app.element.querySelector(`section[data-tab="storage"] [data-item-id="${itemId}"]`);
    return {
      row: !!row,
      bone: !!row?.querySelector(".fa-bone"),
      lock: !!row?.querySelector('[data-action="houseRetrievable"]'),
      claimButtons: app.element.querySelectorAll('[data-action="houseAttemptSpoil"]').length,
      take: !!row?.querySelector('[data-action="retrieveRow"]'),
      tipLocalized: game.i18n.localize("ACKS-LOCATION.storage.spoil") !== "ACKS-LOCATION.storage.spoil",
    };
  },

  /** GM: press the row's lock as a Judge does and wait for the flag. */
  pressLock: async ({ placeId, itemId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(placeId);
    const app = place.sheet;
    const button = app.element.querySelector(`section[data-tab="storage"] [data-item-id="${itemId}"] [data-action="houseRetrievable"]`);
    if (!button) return { pressed: false };
    button.click();
    for (let i = 0; i < 50 && place.items.get(itemId)?.flags?.["acks-extras"]?.storage?.retrievable !== true; i++) await sleep(100);
    await sleep(400);
    const row = app.element.querySelector(`section[data-tab="storage"] [data-item-id="${itemId}"]`);
    return {
      pressed: true,
      retrievable: place.items.get(itemId)?.flags?.["acks-extras"]?.storage?.retrievable === true,
      take: !!row?.querySelector('[data-action="retrieveRow"]'),
    };
  },

  /**
   * Player seat: retrieve the spoil to the hero, as the sheets' take buttons do.
   * `release` waits up to five seconds for the GM's lock to reach this client.
   */
  retrieve: async ({ placeId, heroId, itemId, tag, release, gmId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(heroId);
    const flagged = () => place.items.get(itemId)?.flags?.["acks-extras"]?.storage?.retrievable === true;
    for (let i = 0; i < 50 && flagged() !== release; i++) await sleep(100);
    const answer = await S.retrieve(place, hero, [{ id: itemId }]);
    await sleep(1000);
    return {
      isGM: game.user.isGM,
      owns: hero.isOwner,
      activeGMIsTheWalksSeat: game.users.activeGM?.id === gmId,
      ok: !!answer?.ok,
      reason: answer?.reason ?? null,
      atPlace: place.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      onHero: hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      stillSpoil: hero.items.some((i) => i.flags?.world?.fixtureItem === tag && i.flags?.["acks-extras"]?.spoil),
    };
  },

  close: async ({ placeId }) => {
    const app = game.actors.get(placeId)?.sheet;
    if (app?.rendered) await app.close({ animate: false });
    return true;
  },

  boot: async () => globalThis.__lhsBoot ?? null,
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
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.location && !!globalThis.acksExtras?.lib?.storage`);
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
  note("census", { role: census.role, module: !!census.module });
  if (census.role !== 4) throw new Error("the GM seat is not a gamemaster");
  const player = await seat("player");
  const pc = await run(player, P.census);
  if (pc.role >= 3) throw new Error("the player seat is not a player");

  section("fixtures");
  const place = await gm.fixture("location/house-spoil", "Actor", { name: "House Spoil Walk Place", type: LOCATION, ownership: { default: 0, [pc.userId]: 2 } });
  const hero = await gm.fixture("location/house-spoil-hero", "Actor", { name: "House Spoil Walk Hero", type: "character", ownership: { default: 0, [pc.userId]: 3 } });
  placeId = place.id;
  note("fixtures", { place: { built: place.built }, hero: { built: hero.built } });
  const shaped = await run(gm, P.shape, { placeId: place.id, heroId: hero.id, tag: TAG });
  check("the place holds goods and one locked house spoil, and the hero carries none of the walk's items", shaped.provider && shaped.rows === 1 && shaped.spoil && shaped.houseOwned && shaped.locked && shaped.heroItems === 0, shaped);

  section("load recorder");
  note("gm recorded reload ready after (s)", await reloadRecorded(gm, "gm"));
  note("player recorded reload ready after (s)", await reloadRecorded(player, "player"));

  section("25. the Player seat");
  await sleep(3000);
  const p = await run(player, P.sheet, { placeId: place.id });
  note("player sheet", p);
  check("the Player seat opens the place", p.visible && !p.isGM);
  check("no claim button and no throw glyph anywhere in its render, and no claim string left raw", p.claimButtons === 0 && p.diceGlyphs === 0 && !p.raw, p);
  check("the Storage tab is the Judge's: the Player seat has none", !p.storageTab && !p.tabs.includes("storage"), p.tabs);
  const refused = await run(player, P.retrieve, { placeId: place.id, heroId: hero.id, itemId: shaped.itemId, tag: TAG, release: false, gmId: census.userId });
  note("player retrieve (locked)", refused);
  check("the seat's own seat-and-GM state is the walk's: a player, owning the hero, with the walk's GM seat answering relays", !refused.isGM && refused.owns && refused.activeGMIsTheWalksSeat, refused);
  check("while the row is locked a retrieval is refused and the spoil stays at the place", !refused.ok && refused.atPlace === 1 && refused.onHero === 0, refused);

  section("25. the GM seat");
  const g = await run(gm, P.sheet, { placeId: place.id });
  check("the GM seat's sheet carries no claim button and no throw glyph", g.visible && g.isGM && g.claimButtons === 0 && g.diceGlyphs === 0 && !g.raw && g.storageTab, g);
  const row = await run(gm, P.storageRow, { placeId: place.id, itemId: shaped.itemId });
  note("gm storage row", row);
  check("the Storage tab draws the spoil with its mark and the release lock, a label that localizes, and no claim button", row.row && row.bone && row.lock && row.claimButtons === 0 && row.tipLocalized, row);
  const lock = await run(gm, P.pressLock, { placeId: place.id, itemId: shaped.itemId });
  check("pressing the lock marks the row retrievable", lock.pressed && lock.retrievable, lock);

  section("25. the Player seat retrieves the released spoil");
  const taken = await run(player, P.retrieve, { placeId: place.id, heroId: hero.id, itemId: shaped.itemId, tag: TAG, release: true, gmId: census.userId });
  note("player retrieve (released)", taken);
  check("the Player seat's retrieval lands: the spoil leaves the place and sits on the hero, still a spoil", taken.ok && taken.atPlace === 0 && taken.onHero === 1 && taken.stillSpoil, taken);

  section("console");
  for (const [key, api] of Object.entries(seats)) {
    const boot = await run(api, P.boot);
    check(`${key}: the recorder saw init, setup and ready and no error from load to the walk's end`, boot && ["init", "setup", "ready"].every((x) => boot.phases.includes(x)) && boot.errors.length === 0, boot && { phases: boot.phases, errors: boot.errors.length });
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  for (const api of Object.values(seats)) {
    if (placeId) { try { await run(api, P.close, { placeId }); } catch {} }
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
