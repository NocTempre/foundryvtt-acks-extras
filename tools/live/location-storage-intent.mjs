/**
 * Live walk, location-storage-intent: a place holds goods only once a GM turns
 * that on. Walks docs/location/TESTING.md step 23: a location made now carries
 * no storage; the storage manager lists every place that holds goods and no
 * other, and **Add a place** turns one on through its picker; the location
 * sheet's Storage tab offers **Hold goods here** and no deposit while storage
 * is off, and a GM's drop turns it on; a player seat's stash into a place with
 * storage off is refused, and lands once it is on; the once-per-world clearing,
 * run dry, names an empty location left holding goods and spares one with goods
 * on it; the world-start prune, run dry, spares an empty place that holds goods.
 * A spoil in a place's house pile is released by the Judge's lock: the Player
 * seat's retrieval is refused while it is locked, the GM seat's Storage tab
 * draws the row with the lock and no claim button, pressing the lock marks it
 * retrievable, and the Player seat's retrieval then lands (step 25). Machine
 * values arrive through ./_env.mjs.
 *
 * With `REPLAY_CLEARING=1` the walk also fires the clearing by its real
 * trigger: it unsets the world's marker and reloads the GM seat, so the
 * primary GM's ready clears every empty location in the world that holds goods
 * by default, as an upgrading world's first start does. That is a world-wide
 * write; check who is seated first (`.claude/rules/live-testing.md`,
 * Concurrency).
 *
 * Fixtures, kept and found by marker: `location/intent-place`, a location
 * switched off and on; `location/intent-legacy`, an empty location holding
 * goods, the shape the world-start clearing acts on; `location/intent-stocked`, a
 * location holding one row kept for the house; `location/intent-hero`, a
 * character the player seat owns, carrying a rope; `location/intent-rope`, a
 * world item the GM drops. Each location also carries a plain item no one keeps
 * there, so the world-start prune leaves it standing while storage is off.
 * `location/intent-new` is the create hook's subject: retired and built again
 * each run. `location/intent-spoil` is a location the player seat only
 * observes (a place the seat owns takes its own writes without the Judge's
 * relay, so the lock would gate nothing), holding one locked house spoil row
 * that carries `flags.world.fixtureItem`; the retrieval carries that row to
 * `location/intent-hero`, and the step's start deletes it from both. Each
 * fixture is brought to shape at its step's start. Every figure
 * printed is a count or a boolean; no place in the world is named.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, logDir, shotDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const LOCATION = "acks-extras.location";
/** The house's owner key (lib/storage-logic.mjs `HOUSE_OWNER`). */
const HOUSE = "acks-extras:house";
/** A plain item on each location, kept for no one: it is not goods held there. */
const LEDGER = { name: "Intent Walk Ledger", type: "item" };
/** The stocked place's row, kept for the house. */
const ROPE = { name: "Intent Walk Rope", type: "item", flags: { "acks-extras": { storage: { ownerUuid: HOUSE, ownerName: "" } } } };
const HERO_ROPE = { name: "Intent Walk Hero Rope", type: "item" };
/** The tag the spoil section's own embedded items carry, on the spoil place and the hero. */
const SPOIL_TAG = "location/intent-spoil";

/** Added to every document a seat loads: errors from the first script on, each with the phase it landed in. */
const RECORDER = `(() => {
  const R = (globalThis.__lsiBoot = { phase: "load", phases: [], errors: [] });
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
const plate = (name) => path.join(process.env.SHOTS === "1" ? shotDir() : logDir(), name).replaceAll("\\", "/");

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  /** The seat's census. The clearing runs once the primary GM is elected, seconds after ready, so the marker is waited for up to `waitMarker` seconds. */
  census: async ({ waitMarker = 0 } = {}) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const marker = () => { try { return game.settings.get("acks-extras", "storageByIntent"); } catch { return "unregistered"; } };
    for (let i = 0; i < waitMarker * 10 && marker() !== true; i++) await sleep(100);
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      role: game.user.role,
      userId: game.user.id,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      manager: typeof acksExtras.location?.openStorageManager,
      pinGone: typeof acksExtras.lib?.storage?.setPinned === "undefined" && typeof acksExtras.lib?.storage?.listedProviders === "undefined",
      cleared: marker(),
    };
  },

  /** Bring a location to a shape: storage on or off, its stored rows the given ones, its plain ledger present. */
  shapePlace: async ({ id, provider, stored = [], ledger }) => {
    const S = acksExtras.lib.storage;
    const place = game.actors.get(id);
    const rows = S.storedItems(place).map((i) => i.id);
    if (rows.length) await place.deleteEmbeddedDocuments("Item", rows);
    if (!place.items.some((i) => i.name === ledger.name)) await place.createEmbeddedDocuments("Item", [ledger]);
    if (stored.length) await place.createEmbeddedDocuments("Item", stored);
    await S.setProvider(place, provider);
    return { provider: S.isProvider(place), held: S.storedItems(place).length, items: place.items.size, vault: !!S.vaultOwnerUuid(place) };
  },

  /** The hero carries one rope and the place holds nothing of theirs. */
  shapeHero: async ({ heroId, rope }) => {
    const hero = game.actors.get(heroId);
    const ropes = hero.items.filter((i) => i.name === rope.name);
    if (ropes.length > 1) await hero.deleteEmbeddedDocuments("Item", ropes.slice(1).map((i) => i.id));
    if (!ropes.length) await hero.createEmbeddedDocuments("Item", [rope]);
    return { ropes: hero.items.filter((i) => i.name === rope.name).length };
  },

  /** What a create leaves on a new location. */
  fresh: async ({ id }) => {
    const a = game.actors.get(id);
    return { type: a?.type, storage: a?.flags?.["acks-extras"]?.storage ?? null, provider: acksExtras.lib.storage.isProvider(a) };
  },

  /** Open the manager on a place and wait for it. */
  open: async ({ placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const app of foundry.applications.instances.values()) if (app.id === "acks-location-storage-manager") await app.close();
    const app = acksExtras.location.openStorageManager(game.actors.get(placeId));
    for (let i = 0; i < 50 && !app.rendered; i++) await sleep(100);
    return { rendered: !!app.rendered };
  },

  /** What the open manager lists, against the world's places that hold goods. */
  read: async ({ ids }) => {
    const S = acksExtras.lib.storage;
    const root = document.getElementById("acks-location-storage-manager");
    const listed = [...(root?.querySelectorAll(".acks-location-manager-place[data-place-uuid]") ?? [])].map((li) => li.dataset.placeUuid);
    const targets = [...(root?.querySelectorAll("select[data-pick=target] option") ?? [])].map((o) => o.value);
    const active = root?.querySelector(".acks-location-manager-place.active")?.dataset.placeUuid ?? null;
    const out = {};
    for (const [key, id] of Object.entries(ids)) {
      const uuid = game.actors.get(id)?.uuid;
      out[key] = { listed: listed.includes(uuid), target: targets.includes(uuid), active: active === uuid, provider: S.isProvider(game.actors.get(id)) };
    }
    const providers = S.providers().map((p) => p.uuid);
    out.world = {
      providers: providers.length,
      listed: listed.length,
      sameSet: providers.length === listed.length && providers.every((u) => listed.includes(u)),
      pinButtons: root?.querySelectorAll('[data-action="togglePin"], [data-action="pinPlace"]').length ?? 0,
      addButton: !!root?.querySelector('[data-action="enableStorage"]'),
      groups: [...(root?.querySelectorAll(".acks-location-manager-goods .acks-location-owner-name") ?? [])].map((el) => ({ name: el.textContent.trim(), dangling: el.classList.contains("acks-location-dangling") })),
    };
    return out;
  },

  /** Press Add a place, pick a place in its picker, and press its OK. */
  addThroughPicker: async ({ placeId, rawType }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(placeId);
    const root = document.getElementById("acks-location-storage-manager");
    root.querySelector('[data-action="enableStorage"]').click();
    let dialog = null;
    for (let i = 0; i < 50 && !dialog; i++) {
      await sleep(100);
      dialog = [...foundry.applications.instances.values()].find((a) => a.element?.querySelector?.('select[name="actor"]') && a.id !== "acks-location-storage-manager");
    }
    if (!dialog) return { dialog: false };
    const select = dialog.element.querySelector('select[name="actor"]');
    const options = [...select.options];
    const names = options.map((o) => game.actors.get(o.value.split(".")[1])?.name ?? "");
    const sorted = names.every((n, i) => i === 0 || n.localeCompare(names[i - 1]) >= 0);
    const mine = options.find((o) => o.value === place.uuid);
    const typed = !!mine && !mine.textContent.includes(rawType) && mine.textContent.includes("(");
    const offersCharacter = options.some((o) => game.actors.get(o.value.split(".")[1])?.type === "character");
    const offersHolder = options.some((o) => acksExtras.lib.storage.isProvider(game.actors.get(o.value.split(".")[1])));
    select.value = place.uuid;
    dialog.element.querySelector('button[data-action="ok"]').click();
    for (let i = 0; i < 50 && !acksExtras.lib.storage.isProvider(place); i++) await sleep(100);
    await sleep(400);
    return { dialog: true, offered: !!mine, sorted, typed, offersCharacter, offersHolder, provider: acksExtras.lib.storage.isProvider(place) };
  },

  /** Open a location's sheet on its Storage tab and read what the tab offers. */
  storageTab: async ({ placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(placeId);
    const sheet = place.sheet;
    if (!sheet.rendered) await sheet.render({ force: true });
    for (let i = 0; i < 50 && !sheet.rendered; i++) await sleep(100);
    sheet.changeTab("storage", "primary");
    await sleep(300);
    const tab = sheet.element.querySelector('section[data-tab="storage"]');
    return {
      rendered: !!sheet.rendered,
      hold: !!tab?.querySelector('[data-action="holdGoods"]'),
      deposit: !!tab?.querySelector('[data-action="depositHere"]'),
      off: !!tab?.textContent.includes(game.i18n.localize("ACKS-LOCATION.storage.storageOff")),
      empty: !!tab?.textContent.includes(game.i18n.localize("ACKS-LOCATION.storage.emptyHere")),
      raw: /ACKS-LOCATION\./.test(tab?.textContent ?? ""),
    };
  },

  /** Press the Storage tab's Hold goods here. */
  hold: async ({ placeId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const place = game.actors.get(placeId);
    const button = place.sheet.element.querySelector('section[data-tab="storage"] [data-action="holdGoods"]');
    if (!button) return { pressed: false };
    button.click();
    for (let i = 0; i < 50 && !acksExtras.lib.storage.isProvider(place); i++) await sleep(100);
    await sleep(400);
    return { pressed: true, provider: acksExtras.lib.storage.isProvider(place) };
  },

  /** The sheet's drop handler, given a world item, as a GM's drag from the sidebar hands it. */
  drop: async ({ placeId, itemId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const place = game.actors.get(placeId);
    const item = game.items.get(itemId);
    await place.sheet._onDropItem(new DragEvent("drop"), item);
    await sleep(400);
    const house = acksExtras.lib.money.HOUSE_OWNER;
    return { provider: S.isProvider(place), houseRows: S.storedItems(place, { ownerUuid: house }).filter((i) => i.name === item.name).length };
  },

  /** Close every sheet and manager this walk opened. */
  closeAll: async ({ ids }) => {
    for (const id of ids) await game.actors.get(id)?.sheet?.close();
    for (const app of foundry.applications.instances.values()) if (app.id === "acks-location-storage-manager") await app.close();
    return true;
  },

  /**
   * Player seat: the places this user's client lists, and a stash of the hero's
   * rope into a place. The GM's last switch reaches this client a second or so
   * after it lands, so the seat first waits up to five for `holds` to be true here.
   */
  playerStash: async ({ heroId, placeId, ropeName, holds }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const S = acksExtras.lib.storage;
    const hero = game.actors.get(heroId);
    const place = game.actors.get(placeId);
    for (let i = 0; i < 50 && S.isProvider(place) !== holds; i++) await sleep(100);
    const rope = hero.items.find((i) => i.name === ropeName);
    const listed = S.providers().some((p) => p.uuid === place.uuid);
    const reachable = (acksExtras.location.reach.reachablePlaces(hero) ?? []).some((p) => p.uuid === place.uuid);
    const answer = rope ? await S.stash(hero, place, [{ id: rope.id }]) : { ok: false, reason: "no rope" };
    await sleep(800);
    return {
      isGM: game.user.isGM,
      owns: hero.isOwner,
      listed,
      reachable,
      ok: !!answer?.ok,
      reason: answer?.reason ?? null,
      onHero: hero.items.filter((i) => i.name === ropeName).length,
      atPlace: S.storedItems(place, { ownerUuid: hero.uuid }).filter((i) => i.name === ropeName).length,
    };
  },

  /** Take the hero's rope back from the place, so the next walk starts from it carried. */
  takeBack: async ({ heroId, placeId, ropeName }) => {
    const S = acksExtras.lib.storage;
    const hero = game.actors.get(heroId);
    const place = game.actors.get(placeId);
    const spec = S.storedItems(place, { ownerUuid: hero.uuid }).filter((i) => i.name === ropeName).map((i) => ({ id: i.id }));
    if (spec.length) await S.retrieve(place, hero, spec);
    return { onHero: hero.items.filter((i) => i.name === ropeName).length };
  },

  /** Bring the spoil place and the hero to shape: the place holds one locked house spoil, and neither carries a stray item of the section's tag. */
  shapeSpoil: async ({ placeId, heroId, tag }) => {
    const S = acksExtras.lib.storage;
    const house = acksExtras.lib.money.HOUSE_OWNER;
    const place = game.actors.get(placeId);
    const hero = game.actors.get(heroId);
    for (const doc of [place, hero]) {
      const own = doc.items.filter((i) => i.flags?.world?.fixtureItem === tag).map((i) => i.id);
      if (own.length) await doc.deleteEmbeddedDocuments("Item", own);
    }
    await S.setProvider(place, true);
    await S.stockProvider(place, [{ name: "Intent Walk Spoil", type: "item", flags: { "acks-extras": { spoil: true }, world: { fixtureItem: tag } } }], { ownerUuid: house, ownerName: "House" });
    const row = place.items.find((i) => i.flags?.world?.fixtureItem === tag);
    return {
      provider: S.isProvider(place),
      rows: place.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      itemId: row?.id ?? null,
      spoil: !!row?.flags?.["acks-extras"]?.spoil,
      houseOwned: row?.flags?.["acks-extras"]?.storage?.ownerUuid === house,
      locked: !row?.flags?.["acks-extras"]?.storage?.retrievable,
      heroItems: hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
    };
  },

  /** GM: read the spoil row on the open Storage tab. */
  spoilRow: async ({ placeId, itemId }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(400);
    const app = game.actors.get(placeId).sheet;
    const row = app.element.querySelector(`section[data-tab="storage"] [data-item-id="${itemId}"]`);
    return {
      row: !!row,
      bone: !!row?.querySelector(".fa-bone"),
      lock: !!row?.querySelector('[data-action="houseRetrievable"]'),
      claimButtons: app.element.querySelectorAll('[data-action="houseAttemptSpoil"]').length,
      diceGlyphs: app.element.querySelectorAll(".fa-dice-d20").length,
      take: !!row?.querySelector('[data-action="retrieveRow"]'),
    };
  },

  /** GM: press the spoil row's lock as a Judge does and wait for the flag. */
  pressSpoilLock: async ({ placeId, itemId }) => {
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
   * `release` is the lock state this client waits up to five seconds to see.
   * `gmId` names the walk's GM seat, which must be the one answering the relay.
   */
  spoilRetrieve: async ({ placeId, heroId, itemId, tag, release, gmId }) => {
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
      ownsPlace: place.isOwner,
      activeGMIsTheWalksSeat: game.users.activeGM?.id === gmId,
      ok: !!answer?.ok,
      reason: answer?.reason ?? null,
      atPlace: place.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      onHero: hero.items.filter((i) => i.flags?.world?.fixtureItem === tag).length,
      stillSpoil: hero.items.some((i) => i.flags?.world?.fixtureItem === tag && i.flags?.["acks-extras"]?.spoil),
    };
  },

  /** Whether the clearing and the prune, both run dry, would take each place. Writes nothing. */
  dryRuns: async ({ ids }) => {
    const SI = await import("/modules/acks-extras/scripts/location/storage-intent.mjs");
    const LM = await import("/modules/acks-extras/scripts/location/module.mjs");
    const cleared = (await SI.clearDefaultStorage({ dryRun: true })).uuids;
    const { doomed } = await LM.pruneEmptyLocations({ dryRun: true });
    const out = {};
    for (const [key, id] of Object.entries(ids)) {
      const uuid = game.actors.get(id)?.uuid;
      out[key] = { cleared: cleared.includes(uuid), pruned: doomed.includes(uuid) };
    }
    out.world = { cleared: cleared.length, pruned: doomed.length };
    return out;
  },

  /** What the load recorder saw on this seat. */
  boot: async () => globalThis.__lsiBoot ?? null,

  /** Unset the world's clearing marker, so the next primary-GM ready runs it. */
  unmark: async () => {
    await game.settings.set("acks-extras", "storageByIntent", false);
    return game.settings.get("acks-extras", "storageByIntent");
  },

  /** After a reload: the marker, waited for up to thirty seconds, and one place's storage. */
  afterReload: async ({ id }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const seconds = Date.now();
    for (let i = 0; i < 300 && game.settings.get("acks-extras", "storageByIntent") !== true; i++) await sleep(100);
    const house = acksExtras.markets?.tradeObjects?.tradeHouseSync?.() ?? null;
    return {
      cleared: game.settings.get("acks-extras", "storageByIntent"),
      afterSeconds: Math.round((Date.now() - seconds) / 1000),
      provider: acksExtras.lib.storage.isProvider(game.actors.get(id)),
      exists: !!game.actors.get(id),
      house: house ? { provider: acksExtras.lib.storage.isProvider(house), stored: acksExtras.lib.storage.storedItems(house).length } : null,
    };
  },
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
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.location?.openStorageManager`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * Reload a seat's page under the load recorder. A second DevTools session adds
 * it to every new document and stays open until the page is ready, since the
 * script lasts no longer than the session that added it.
 */
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

let opened = [];
try {
  section("seats");
  const gm = await seat("gm");
  const census = await run(gm, P.census, { waitMarker: 30 });
  note("census", census);
  check("the GM seat is the active GM, the page serves the manager, and the storage pin is gone", census.activeGMIsSelf && census.role === 4 && census.manager === "function" && census.pinGone, census);
  check("the once-per-world clearing has run on this world", census.cleared === true, census.cleared);
  if (!census.activeGMIsSelf) blocked("another GM client is the active GM");
  const player = await seat("player");
  const pc = await run(player, P.census);
  note("census (player)", { role: pc.role, isGM: pc.role >= 3 });
  if (pc.role >= 3) throw new Error("the player seat is not a player");

  section("fixtures");
  const ownPlayer = { [pc.userId]: 3 };
  const place = await gm.fixture("location/intent-place", "Actor", { name: "Intent Walk Place", type: LOCATION, items: [LEDGER], flags: { "acks-extras": { storage: { provider: true } } } });
  const legacy = await gm.fixture("location/intent-legacy", "Actor", { name: "Intent Walk Legacy Place", type: LOCATION, items: [LEDGER], flags: { "acks-extras": { storage: { provider: true } } } });
  const stocked = await gm.fixture("location/intent-stocked", "Actor", { name: "Intent Walk Stocked Place", type: LOCATION, items: [LEDGER, ROPE], flags: { "acks-extras": { storage: { provider: true } } } });
  const hero = await gm.fixture("location/intent-hero", "Actor", { name: "Intent Walk Hero", type: "character", ownership: { default: 0, ...ownPlayer }, items: [HERO_ROPE] });
  const rope = await gm.fixture("location/intent-rope", "Item", { name: "Intent Walk Dropped Rope", type: "item" });
  const spoilPlace = await gm.fixture("location/intent-spoil", "Actor", { name: "Intent Walk Spoil Place", type: LOCATION, ownership: { default: 0, [pc.userId]: 2 } });
  const ids = { place: place.id, legacy: legacy.id, stocked: stocked.id };
  opened = [...Object.values(ids), spoilPlace.id];
  note("fixtures", { place: place.built, legacy: legacy.built, stocked: stocked.built, hero: hero.built, rope: rope.built, spoilPlace: spoilPlace.built });
  const shaped = {
    place: await run(gm, P.shapePlace, { id: place.id, provider: false, ledger: LEDGER }),
    legacy: await run(gm, P.shapePlace, { id: legacy.id, provider: true, ledger: LEDGER }),
    stocked: await run(gm, P.shapePlace, { id: stocked.id, provider: true, stored: [ROPE], ledger: LEDGER }),
    hero: await run(gm, P.shapeHero, { heroId: hero.id, rope: HERO_ROPE }),
  };
  note("shape", shaped);
  check("the place's storage is off, the legacy place holds goods with nothing kept, the stocked one keeps a row, the hero carries one rope",
    !shaped.place.provider && shaped.place.held === 0 && shaped.legacy.provider && shaped.legacy.held === 0 && !shaped.legacy.vault && shaped.stocked.provider && shaped.stocked.held === 1 && shaped.hero.ropes === 1, shaped);

  section("load recorder");
  // Both seats reload under the recorder, so init, setup and ready are on it.
  // With REPLAY_CLEARING the marker is unset first: this reload's ready is then
  // the real trigger, as an upgrading world's first start is.
  const replay = process.env.REPLAY_CLEARING === "1";
  if (replay) check("the marker is unset", (await run(gm, P.unmark)) === false);
  note("gm recorded reload ready after (s)", await reloadRecorded(gm, "gm"));
  note("player recorded reload ready after (s)", await reloadRecorded(player, "player"));
  if (replay) {
    section("23. the clearing at a world's first start");
    const after = await run(gm, P.afterReload, { id: legacy.id });
    check("the primary GM's ready turned the legacy place's storage off and set the marker", after.exists && !after.provider && after.cleared === true, after);
    const kept = await run(gm, P.afterReload, { id: stocked.id });
    check("and left the stocked place holding goods", kept.provider, kept);
    check("and the trade house, where the world has one", after.house === null || after.house.provider, after.house);
    note("legacy re-shaped", await run(gm, P.shapePlace, { id: legacy.id, provider: true, ledger: LEDGER }));
  }

  section("23. a location made now holds no goods");
  note("retire", await gm.retire("location/intent-new", "Actor"));
  const made = await gm.fixture("location/intent-new", "Actor", { name: "Intent Walk New Place", type: LOCATION });
  const fresh = await run(gm, P.fresh, { id: made.id });
  check("its create leaves no storage flag", made.built && fresh.type === LOCATION && fresh.storage === null && !fresh.provider, fresh);

  section("23. the manager lists every place that holds goods, and no other");
  await run(gm, P.open, { placeId: stocked.id });
  let r = await run(gm, P.read, { ids });
  note("read", r);
  check("the list is exactly the world's places that hold goods, with no pin", r.world.sameSet && r.world.pinButtons === 0 && r.world.addButton, r.world);
  check("the place with storage off is neither listed nor a Move to target", !r.place.listed && !r.place.target, r.place);
  check("the legacy place and the stocked one are listed", r.legacy.listed && r.stocked.listed && r.stocked.active);
  const houseName = await gm.eval(`game.i18n.localize("ACKS-LOCATION.storage.house")`);
  check("the stocked place's house row is grouped under the house, with no gone-owner warning",
    r.world.groups.length === 1 && r.world.groups[0].name === houseName && !r.world.groups[0].dangling, r.world.groups);

  section("23. a player cannot leave goods where storage is off");
  let p = await run(player, P.playerStash, { heroId: hero.id, placeId: place.id, ropeName: HERO_ROPE.name, holds: false });
  note("player", p);
  check("on the player seat the place is not among the places that hold goods, nor reachable", !p.isGM && p.owns && !p.listed && !p.reachable, p);
  check("the stash is refused and the rope stays carried", !p.ok && p.reason === "notProvider" && p.onHero === 1 && p.atPlace === 0, p);

  section("23. the Storage tab offers the switch while storage is off");
  let t = await run(gm, P.storageTab, { placeId: place.id });
  note("tab", t);
  check("Hold goods here and the off line show, the deposit does not, no raw key", t.rendered && t.hold && t.off && !t.deposit && !t.raw, t);
  if (process.env.SHOTS === "1") {
    await gm.compose();
    t = await run(gm, P.storageTab, { placeId: place.id });
    note("plate", await gm.shot(plate("location-storage-off.png"), `#${await gm.eval(`game.actors.get(${JSON.stringify(place.id)}).sheet.id`)}`));
    // Composing the frame closed the manager; the redraw below needs it open.
    await run(gm, P.open, { placeId: stocked.id });
    await run(gm, P.storageTab, { placeId: place.id });
  }
  const held = await run(gm, P.hold, { placeId: place.id });
  t = await run(gm, P.storageTab, { placeId: place.id });
  check("pressing it turns storage on; the tab then reads empty and offers the deposit", held.pressed && held.provider && !t.hold && !t.off && t.empty && t.deposit, { held, t });
  r = await run(gm, P.read, { ids });
  check("the open manager redraws with the place listed", r.place.listed && r.world.sameSet, r.place);

  section("23. a player's stash lands once storage is on");
  p = await run(player, P.playerStash, { heroId: hero.id, placeId: place.id, ropeName: HERO_ROPE.name, holds: true });
  note("player", p);
  check("the rope moves to the place, kept for the hero", p.ok && p.onHero === 0 && p.atPlace === 1, p);
  note("take back", await run(gm, P.takeBack, { heroId: hero.id, placeId: place.id, ropeName: HERO_ROPE.name }));

  section("23. Add a place turns storage on from the manager");
  note("off again", await run(gm, P.shapePlace, { id: place.id, provider: false, ledger: LEDGER }));
  await run(gm, P.open, { placeId: stocked.id });
  // A row printing the raw sub-type is reading the type, not its label.
  const added = await run(gm, P.addThroughPicker, { placeId: place.id, rawType: LOCATION });
  note("picker", added);
  check("the picker offers the place by name in order, with its type's label, and no character or place already holding goods",
    added.dialog && added.offered && added.sorted && added.typed && !added.offersCharacter && !added.offersHolder, added);
  r = await run(gm, P.read, { ids });
  check("picked, it holds goods, is listed and open", added.provider && r.place.listed && r.place.active, r.place);

  section("23. a GM's drop turns storage on");
  note("off again", await run(gm, P.shapePlace, { id: place.id, provider: false, ledger: LEDGER }));
  const dropped = await run(gm, P.drop, { placeId: place.id, itemId: rope.id });
  check("dropping a sidebar item on the sheet turns storage on and keeps the item for the house", dropped.provider && dropped.houseRows === 1, dropped);

  section("23. the clearing and the prune, run dry");
  const dry = await run(gm, P.dryRuns, { ids: { ...ids, made: made.id } });
  note("dry", dry);
  check("the clearing names the legacy place and spares the stocked one and the place now holding a row", dry.legacy.cleared && !dry.stocked.cleared && !dry.place.cleared, dry);
  check("the prune spares every place holding goods, and takes the new empty one", !dry.legacy.pruned && !dry.stocked.pruned && !dry.place.pruned && dry.made.pruned, dry);

  section("25. a spoil in the house pile is released by the Judge's lock");
  const spoil = await run(gm, P.shapeSpoil, { placeId: spoilPlace.id, heroId: hero.id, tag: SPOIL_TAG });
  check("the spoil place holds one locked house spoil, and the hero carries none of the section's items", spoil.provider && spoil.rows === 1 && spoil.spoil && spoil.houseOwned && spoil.locked && spoil.heroItems === 0, spoil);
  const refused = await run(player, P.spoilRetrieve, { placeId: spoilPlace.id, heroId: hero.id, itemId: spoil.itemId, tag: SPOIL_TAG, release: false, gmId: census.userId });
  note("player retrieve (locked)", refused);
  check("the player seat owns the hero and not the place, and the walk's GM seat answers relays", !refused.isGM && refused.owns && !refused.ownsPlace && refused.activeGMIsTheWalksSeat, refused);
  check("while the row is locked a retrieval is refused and the spoil stays at the place", !refused.ok && refused.atPlace === 1 && refused.onHero === 0, refused);
  await run(gm, P.storageTab, { placeId: spoilPlace.id });
  const spoilRow = await run(gm, P.spoilRow, { placeId: spoilPlace.id, itemId: spoil.itemId });
  note("gm storage row", spoilRow);
  check("the Storage tab draws the spoil with its mark and the release lock, no claim button and no throw glyph", spoilRow.row && spoilRow.bone && spoilRow.lock && spoilRow.claimButtons === 0 && spoilRow.diceGlyphs === 0, spoilRow);
  const lock = await run(gm, P.pressSpoilLock, { placeId: spoilPlace.id, itemId: spoil.itemId });
  check("pressing the lock marks the row retrievable", lock.pressed && lock.retrievable, lock);
  const taken = await run(player, P.spoilRetrieve, { placeId: spoilPlace.id, heroId: hero.id, itemId: spoil.itemId, tag: SPOIL_TAG, release: true, gmId: census.userId });
  note("player retrieve (released)", taken);
  check("the player seat's retrieval lands: the spoil leaves the place and sits on the hero, still a spoil", taken.ok && taken.atPlace === 0 && taken.onHero === 1 && taken.stillSpoil, taken);

  if (process.env.SHOTS === "1") {
    await gm.compose();
    await run(gm, P.open, { placeId: stocked.id });
    await sleep(500);
    note("plate", await gm.shot(plate("location-storage-manager.png"), "#acks-location-storage-manager"));
  }

  section("console");
  for (const [key, api] of Object.entries(seats)) {
    const boot = await run(api, P.boot);
    check(`${key}: the recorder saw init, setup and ready and no error from load to the walk's end`, boot && ["init", "setup", "ready"].every((p) => boot.phases.includes(p)) && boot.errors.length === 0, boot && { phases: boot.phases, errors: boot.errors });
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (seats.gm && opened.length) {
    try { await run(seats.gm, P.closeAll, { ids: opened }); } catch {}
  }
  for (const api of Object.values(seats)) {
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
