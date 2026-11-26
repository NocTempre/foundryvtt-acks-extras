/**
 * Live walk, character-sheet-set-down: Open on a ground pile's row needs
 * OBSERVER on the pile. Walks docs/character-sheet/TESTING.md "Set down a pack
 * from the Equipment tab", step 13, from the Player seat that owns the
 * character (with the Judge seat reading the same pile sheet and writing the
 * pile's default ownership): the Player presses Set down on the worn pack's
 * header (the real control, step 1's press, which makes the pile this step
 * reads); the Kept elsewhere row names the pile with an Open control and its
 * name a link; Open renders the pile's own sheet with a Storage tab that lists
 * every good the pile holds and offers a Take on rows stamped to the Player's
 * character, with no Deposit, no Hold goods, no house lock and no Open manager;
 * the Judge's seat opens the same sheet with no Deposit either; the Judge sets
 * the pile's default ownership to None and the Player's sheet, redrawn, loses
 * the Open control and the name reads as text, on the Equipment tab's row and on
 * the system sheet's Storage tab; the default is set back to Observer and the
 * control returns. The Player then presses Pick up, which puts the pack back on
 * Back (the kept fixture's shape) and removes the pile. Prints booleans and
 * counts, never a name or an id. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the Judge seat builds them):
 * `character-sheet/set-down-hero` (a character the Player owns, linked, wearing a
 * pack on Back that holds a stack of torches, a money row and a dagger, with a
 * sack stowed and a locked box carried), its token `character-sheet/set-down-hero-token`
 * on the scene `location/ground-scene`. The pack is declared as holding goods
 * and states no capacity. The run's own documents (the pile and its token) are
 * tracked by uuid and swept alone. The pile's default ownership is read at the
 * start, written to None for the step, and put back to the value the run found
 * in the finally.
 *
 * Not walked here: the bystander's row (step 13 names it as the bystander's
 * Player, a second Player seat this runner does not drive) and the Take rule's
 * negative case, a row stamped to someone else's character. The rest of the
 * recipe's steps belong to other walks.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const skip = (label, reason) => console.log(`SKIP  ${label}  ${reason}`);

/** The invented names the fixture's rows carry; the walk reads them back off the pile's rows. */
const NAMES = Object.freeze({ pack: "QA Set-down Pack", torch: "QA Torch Bundle", coin: "QA Coin Purse", dagger: "QA Dagger", sack: "QA Spare Sack", box: "QA Locked Box" });

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__sd = globalThis.__sd ?? {});
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
    try {
      // The weapon rows' first publication redraws every open actor sheet: the walk opens none before it has landed.
      const rows = await import("/modules/acks-extras/scripts/equipment/weapon-rows.mjs");
      await Promise.race([rows.rowsReady(), H.sleep(60000)]);
    } catch { /* the module has no such publication on this build */ }
    await H.sleep(300);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, storage: typeof globalThis.acksExtras?.lib?.storage?.retrieve === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  selfId: async () => game.user.id,
  observes: async ({ uuid }) => !!(await fromUuid(uuid))?.testUserPermission(game.user, "OBSERVER"),
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    return true;
  },
  /**
   * On the Judge's seat: the hero's items as the fixture needs them. A fresh actor with no items is given the
   * pack worn on Back with its three goods, a sack carried and a locked box; a kept one is read, never rebuilt.
   */
  shape: async ({ heroId, names }) => {
    const hero = game.actors.get(heroId);
    const MOD = "acks-extras";
    const base = { subtype: "item", cost: 0, weight6: 0, quantity: 1 };
    let built = false;
    if (!hero.items.size) {
      built = true;
      const [pack] = await hero.createEmbeddedDocuments("Item", [{ name: names.pack, type: "item", system: base, flags: { [MOD]: { gear: { slots: ["back"], wornAt: "back", holds: true } } } }]);
      const inside = { [MOD]: { containedIn: pack.id } };
      await hero.createEmbeddedDocuments("Item", [
        { name: names.torch, type: "item", system: { ...base, quantity: 3 }, flags: inside },
        { name: names.coin, type: "money", system: { coppervalue: 100, quantity: 40, quantitybank: 0 }, flags: inside },
        { name: names.dagger, type: "item", system: base, flags: inside },
        { name: names.sack, type: "item", system: base, flags: { [MOD]: { gear: { holds: true } } } },
        { name: names.box, type: "item", system: base, flags: { [MOD]: { container: { locked: true }, gear: { holds: true } } } },
      ]);
    }
    const pack = hero.items.find((i) => i.name === names.pack);
    const contents = pack ? hero.items.filter((i) => i.getFlag(MOD, "containedIn") === pack.id).map((i) => i.name) : [];
    const S = acksExtras.lib.storage;
    const piles = game.actors.filter((a) => a.getFlag(MOD, "ground") && S.storedItems(a, { ownerUuid: hero.uuid }).length).map((a) => a.uuid);
    const tokens = game.scenes.reduce((n, s) => n + s.tokens.filter((t) => t.actorId === hero.id).length, 0);
    return { built, pack: !!pack, packId: pack?.id ?? null, onBack: pack?.getFlag(MOD, "gear")?.wornAt === "back", contents, linked: !!hero.prototypeToken?.actorLink, tokens, piles, owned: hero.items.size };
  },
  /** On the Judge's seat: the piles standing for the hero, and the tokens each has on any scene. */
  pilesOf: async ({ heroUuid }) => {
    const S = acksExtras.lib.storage;
    return game.actors
      .filter((a) => a.getFlag("acks-extras", "ground") && S.storedItems(a, { ownerUuid: heroUuid }).length)
      .map((a) => ({
        uuid: a.uuid,
        id: a.id,
        goods: S.storedItems(a, { ownerUuid: heroUuid }).length,
        held: a.items.size,
        defaultLevel: a._source.ownership?.default ?? null,
        tokens: game.scenes.flatMap((s) => s.tokens.filter((t) => t.actorId === a.id).map((t) => t.uuid)),
      }));
  },
  /** On the Judge's seat: take everything a leftover pile holds of the hero's back to the hero, as its Pick up does. */
  recover: async ({ heroId, pileUuid }) => {
    const S = acksExtras.lib.storage;
    const hero = game.actors.get(heroId);
    const pile = await fromUuid(pileUuid);
    if (!pile) return { found: false };
    const spec = S.storedItems(pile, { ownerUuid: hero.uuid }).map((i) => ({ id: i.id }));
    const answer = spec.length ? await S.retrieve(pile, hero, spec) : null;
    return { found: true, spec: spec.length, ok: answer?.ok ?? null };
  },
  /** Read the pile's default ownership as stored; with `level` given, write it first. */
  defaultLevel: async ({ pileUuid, level = null }) => {
    const pile = await fromUuid(pileUuid);
    if (!pile) return { found: false };
    if (level !== null) await pile.update({ "ownership.default": level });
    return { found: true, level: pile._source.ownership?.default ?? null };
  },
  /** Open the hero's own sheet on its Equipment tab. */
  openHero: async ({ actorId }) => {
    const H = globalThis.__sd;
    const sheet = game.actors.get(actorId).sheet;
    if (!sheet.rendered) await sheet.render(true);
    await H.poll(() => H.root(sheet)?.isConnected);
    sheet.changeTab("equipment", "primary");
    await H.sleep(700);
    return { rendered: !!H.root(sheet)?.querySelector("section[data-tab='equipment']") };
  },
  /** Redraw an open hero sheet and wait for its Equipment tab to draw again. */
  redraw: async ({ actorId }) => {
    const H = globalThis.__sd;
    const sheet = game.actors.get(actorId).sheet;
    await sheet.render(true);
    await H.poll(() => H.root(sheet)?.querySelector("section[data-tab='equipment']"));
    sheet.changeTab("equipment", "primary");
    await H.sleep(900);
    return { rendered: !!H.root(sheet)?.querySelector("section[data-tab='equipment']") };
  },
  /** The id of the hero's item by name. */
  itemId: async ({ actorId, name }) => game.actors.get(actorId).items.find((i) => i.name === name)?.id ?? null,
  /** Press Set down in the named container's header on the open hero sheet. */
  pressSetDown: async ({ actorId, itemId }) => {
    const H = globalThis.__sd;
    const root = H.root(game.actors.get(actorId).sheet);
    const button = root?.querySelector(`[data-item-id="${itemId}"] > .acks-extras-frame__gear-head [data-action="containerSetDown"]`);
    if (!button) return { button: false };
    button.click();
    return { button: true };
  },
  /** Press a control on the pile's Kept elsewhere row. */
  pressRow: async ({ actorId, pileUuid, action }) => {
    const H = globalThis.__sd;
    const root = H.root(game.actors.get(actorId).sheet);
    const row = root?.querySelector(`.acks-extras-kept[data-place-uuid="${pileUuid}"]`);
    const button = row?.querySelector(`.acks-extras-frame__ctls [data-action="${action}"]`);
    if (!button) return { button: false };
    button.click();
    await H.sleep(700);
    return { button: true };
  },
  /** The pile's Kept elsewhere row on the open hero sheet, as booleans and the name's tag. */
  pileRow: async ({ actorId, pileUuid }) => {
    const H = globalThis.__sd;
    const root = H.root(game.actors.get(actorId).sheet);
    const row = root?.querySelector(`.acks-extras-kept[data-place-uuid="${pileUuid}"]`);
    if (!row) return { row: false };
    const name = row.querySelector(".acks-extras-frame__row-text .acks-extras-frame__gear-name");
    const control = (action) => row.querySelector(`.acks-extras-frame__ctls [data-action="${action}"]`);
    const open = control("placeOpen");
    return {
      row: true,
      nameTag: name?.tagName ?? null,
      nameAction: name?.getAttribute("data-action") ?? null,
      openButton: !!open,
      openTooltip: !!(open?.getAttribute("data-tooltip") || open?.getAttribute("data-tooltip-text")),
      deposit: !!control("placeDeposit"),
      pin: !!control("placePin"),
      pickUp: !!control("placeRetrieveAll"),
      labelText: name?.textContent.trim() ?? "",
    };
  },
  /** Open the pile's own sheet on this seat and read its Storage tab: rows, the owners they group under, and the controls it draws. */
  pileSheet: async ({ pileUuid }) => {
    const H = globalThis.__sd;
    const pile = await fromUuid(pileUuid);
    if (!pile) return { found: false };
    const sheet = pile.sheet;
    if (!sheet.rendered) await sheet.render(true);
    const root = await H.poll(() => (H.root(sheet)?.isConnected ? H.root(sheet) : null), { tries: 60, every: 200 });
    if (!root) return { found: true, rendered: false };
    try { sheet.changeTab("storage", "primary"); } catch { /* the tab is not offered: the reads below say so */ }
    await H.sleep(700);
    const tab = root.querySelector("section[data-tab='storage']");
    if (!tab) return { found: true, rendered: true, storageTab: false, tabs: [...root.querySelectorAll("[data-tab]")].map((e) => e.dataset.tab).slice(0, 12) };
    const has = (action) => !!tab.querySelector(`[data-action="${action}"]`);
    const rows = [...tab.querySelectorAll(".acks-location-row")];
    return {
      found: true,
      rendered: true,
      storageTab: true,
      held: pile.items.size,
      rowNames: rows.map((r) => r.querySelector(".acks-location-row-name")?.textContent.trim() ?? ""),
      rowsWithTake: rows.filter((r) => r.querySelector('[data-action="retrieveRow"]')).length,
      owners: [...tab.querySelectorAll(".acks-location-owner")].map((o) => o.dataset.ownerUuid),
      deposit: has("depositHere"),
      holdGoods: has("holdGoods"),
      houseLock: has("houseRetrievable"),
      manager: has("openManager"),
      pay: has("payHouse"),
    };
  },
  /** Render the system's own character sheet on the hero and read the pile's place row on its Storage tab. */
  sysStorage: async ({ actorId, pileUuid }) => {
    const H = globalThis.__sd;
    const actor = game.actors.get(actorId);
    const entry = Object.entries(CONFIG.Actor.sheetClasses.character ?? {}).find(([id, e]) => !id.startsWith("acks-extras.") && e.cls);
    if (!entry) return { sheetClass: false };
    if (H.sys && !H.sys.rendered) H.sys = null;
    if (!H.sys) H.sys = new entry[1].cls({ document: actor });
    await H.sys.render(true);
    const root = await H.poll(() => {
      const r = H.root(H.sys);
      return r?.isConnected && r.querySelector(`[data-place-uuid="${pileUuid}"]`) ? r : null;
    }, { tries: 60, every: 200 });
    if (!root) return { sheetClass: true, rendered: !!H.root(H.sys)?.isConnected, row: false, kind: entry[0] };
    const name = root.querySelector(`[data-place-uuid="${pileUuid}"] .acks-location-place-name`);
    return { sheetClass: true, rendered: true, row: true, nameTag: name?.tagName ?? null, nameAction: name?.getAttribute("data-acksl-action") ?? null };
  },
  /** The hero after a Pick up: the pack worn on Back, what it holds, and whether the pile is gone. */
  restored: async ({ heroId, pileUuid, names }) => {
    const hero = game.actors.get(heroId);
    const MOD = "acks-extras";
    const pack = hero.items.find((i) => i.name === names.pack);
    return {
      packOnBack: pack?.getFlag(MOD, "gear")?.wornAt === "back",
      unmarked: !pack?.getFlag(MOD, "setDown"),
      contents: pack ? hero.items.filter((i) => i.getFlag(MOD, "containedIn") === pack.id).map((i) => i.name).sort() : [],
      pileGone: !game.actors.get(String(pileUuid).split(".").pop()),
      packCount: hero.items.filter((i) => i.name === names.pack).length,
    };
  },
  drain: async () => {
    const H = globalThis.__sd;
    const out = { errors: H.errors.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  restore: async () => {
    const H = globalThis.__sd;
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

async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.storage`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Poll a page read until `test(result)` holds or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 40, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}

let gm = null;
let player = null;
/** The uuids of what this run made (the pile and its token): the only documents teardown deletes. */
const own = [];
const track = async (uuid, kind) => {
  if (!uuid || own.includes(uuid)) return;
  own.push(uuid);
  await gm.track(uuid, kind);
};
/** The pile this run set down and the default ownership it found on it, for the finally to put back. */
let pileUuid = null;
let foundLevel = null;
let levelChanged = false;
let heroIdForCleanup = null;

const WALL_MS = Number(process.env.WALK_WALL_MS ?? 420_000);
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
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  if (!installed.isGM || !installed.activeGMIsSelf) blocked("the GM seat is not the active GM, so a Player's Set down reaches no Judge");
  check("the GM seat is the active GM and the Player seat is a player, both with storage", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2 && installed.storage && seated.storage, { gm: installed.role, player: seated.role });

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const scene = await gm.fixture("location/ground-scene", "Scene", {
    name: "QA Ground Field", active: false, navigation: true, width: 1400, height: 900, padding: 0, backgroundColor: "#5a6b55",
    grid: { type: 1, size: 100, distance: 5, units: "ft" }, tokenVision: false, ownership: { default: 2 },
  });
  const hero = await gm.fixture("character-sheet/set-down-hero", "Actor", {
    name: "QA Set-down Hero", type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 9, max: 9 } }, ownership: { default: 0, [playerId]: 3 },
  });
  const heroId = idOf(hero);
  heroIdForCleanup = heroId;
  const heroUuid = `Actor.${heroId}`;
  await gm.fixture("character-sheet/set-down-hero-token", "Token", { name: "QA Set-down Hero", actorId: heroId, actorLink: true, x: 300, y: 300, width: 1, height: 1 }, { parent: scene.uuid });
  const shaped = await run(gm, P.shape, { heroId, names: NAMES });
  note("the hero's items were built this run", shaped.built);
  // A pile a stopped run left holds the pack: its goods go back to the hero before the walk reads anything.
  for (const leftover of shaped.piles) {
    const back = await run(gm, P.recover, { heroId, pileUuid: leftover });
    note("a leftover pile of the hero's was emptied back to the hero (found, goods, ok)", back);
  }
  const shape = shaped.piles.length ? await until(gm, P.shape, { heroId, names: NAMES }, (s) => s.piles.length === 0 && s.onBack, { tries: 40 }) : shaped;
  check("shape: the pack is worn on Back with its three goods, the sack and the box are carried, one token, no pile standing", shape.pack && shape.onBack && shape.linked && shape.contents.length === 3 && shape.owned === 6 && shape.tokens === 1 && shape.piles.length === 0, { onBack: shape.onBack, contents: shape.contents?.length, owned: shape.owned, tokens: shape.tokens, piles: shape.piles?.length });
  if (!shape.pack || !shape.onBack || shape.piles.length) throw new Error("the hero is not in the shape step 1 expects");
  check("the Player seat's own user owns the hero", (await run(player, P.selfId)) === playerId && (await until(player, P.observes, { uuid: heroUuid }, (v) => v === true)) === true);
  await run(player, P.drain);
  await run(gm, P.drain);

  section("1. the Player sets the worn pack down from its header, which makes the pile step 13 reads");
  await run(player, P.clearWindows);
  const opened = await run(player, P.openHero, { actorId: heroId });
  check("1: the Player opens the hero's sheet on its Equipment tab", opened.rendered);
  const packId = await run(player, P.itemId, { actorId: heroId, name: NAMES.pack });
  const pressed = await run(player, P.pressSetDown, { actorId: heroId, itemId: packId });
  check("1: the pack's header offers Set down, and it is pressed", pressed.button);
  if (!pressed.button) throw new Error("no Set down control on the pack's header");
  const standing = await until(gm, P.pilesOf, { heroUuid }, (l) => l.length === 1, { tries: 60, every: 300 });
  check("1: one pile stands, holding the pack and its three goods (four rows)", standing.length === 1 && standing[0].goods === 4 && standing[0].held === 4, { piles: standing.length, goods: standing[0]?.goods, held: standing[0]?.held });
  if (standing.length !== 1) throw new Error("the press made no single pile; every later step reads it");
  pileUuid = standing[0].uuid;
  foundLevel = standing[0].defaultLevel;
  await track(pileUuid, "Actor");
  for (const t of standing[0].tokens) await track(t, "Token");
  check("1: the pile's default ownership is Observer (2) as the Judge's seat stores it", foundLevel === 2, { level: foundLevel });

  section("13. Open needs OBSERVER on the pile");
  const seesPile = await until(player, P.observes, { uuid: pileUuid }, (v) => v === true);
  check("13: the Player seat reads OBSERVER on the pile", seesPile === true);
  const row = await until(player, P.pileRow, { actorId: heroId, pileUuid }, (r) => r.row, { tries: 40, every: 300 });
  check("13: the Kept elsewhere row for the pile appears without a reload, naming the pack", row.row && row.labelText.includes(NAMES.pack), { row: row.row });
  check("13: the row has an Open control (named by a tooltip) and its name is a link that opens", row.openButton && row.openTooltip && row.nameTag === "A" && row.nameAction === "placeOpen", { open: row.openButton, tooltip: row.openTooltip, tag: row.nameTag, action: row.nameAction });
  check("13: the row offers Pick up and no Deposit and no Pin", row.pickUp && !row.deposit && !row.pin, { pickUp: row.pickUp, deposit: row.deposit, pin: row.pin });
  skip("13: the bystander's row has an Open control and a link name", "needs the bystander's own Player seat; this runner drives one Player seat, and a sheet the Player does not own draws no Kept elsewhere row");

  section("13. Open renders the pile's own sheet for the Player");
  const pressedOpen = await run(player, P.pressRow, { actorId: heroId, pileUuid, action: "placeOpen" });
  check("13: Open is pressed on the pile's row", pressedOpen.button);
  const asPlayer = await run(player, P.pileSheet, { pileUuid });
  check("13: the pile's own sheet renders on the Player seat with a Storage tab", asPlayer.rendered && asPlayer.storageTab, { rendered: asPlayer.rendered, storageTab: asPlayer.storageTab, tabs: asPlayer.tabs });
  const wanted = [NAMES.pack, NAMES.torch, NAMES.coin, NAMES.dagger];
  check("13: the Storage tab lists every good the pile holds (the pack, the torches, the coin row and the dagger)", wanted.every((n) => asPlayer.rowNames?.some((r) => r.includes(n))) && asPlayer.rowNames?.length === asPlayer.held, { rows: asPlayer.rowNames?.length, held: asPlayer.held });
  check("13: the Player's sheet has no Deposit, no Hold goods, no house lock and no Open manager", asPlayer.storageTab && !asPlayer.deposit && !asPlayer.holdGoods && !asPlayer.houseLock && !asPlayer.manager, { deposit: asPlayer.deposit, holdGoods: asPlayer.holdGoods, houseLock: asPlayer.houseLock, manager: asPlayer.manager });
  check("13: every row is stamped to the Player's own character, and each carries a Take", asPlayer.owners?.length > 0 && asPlayer.owners.every((o) => o === heroUuid) && asPlayer.rowsWithTake === asPlayer.rowNames?.length, { owners: asPlayer.owners?.length, rows: asPlayer.rowNames?.length, take: asPlayer.rowsWithTake });
  skip("13: a Take shows only on a row stamped to that Player's character (the negative case)", "needs a pile row stamped to a character the Player does not own; the fixture pile holds only the hero's goods");
  await run(player, P.clearWindows);

  section("13. the Judge's seat opens the same sheet");
  const asGm = await run(gm, P.pileSheet, { pileUuid });
  check("13: the pile's sheet renders on the Judge seat with a Storage tab listing the same rows", asGm.rendered && asGm.storageTab && asGm.rowNames?.length === asPlayer.rowNames?.length, { rows: asGm.rowNames?.length });
  check("13: the Judge's sheet has no Deposit and no Hold goods either (a pile takes none)", asGm.storageTab && !asGm.deposit && !asGm.holdGoods, { deposit: asGm.deposit, holdGoods: asGm.holdGoods });
  note("13: the Judge's sheet offers Open manager, house lock, pay (printed, not asserted)", { manager: asGm.manager, houseLock: asGm.houseLock, pay: asGm.pay });
  await run(gm, P.clearWindows);

  section("13. the system sheet's Storage tab, while the Player observes the pile");
  const sysBefore = await run(player, P.sysStorage, { actorId: heroId, pileUuid });
  check("13: the system sheet draws the pile's place row on its Storage tab", sysBefore.sheetClass && sysBefore.row, sysBefore);
  check("13: its name is a link that opens the pile while the Player observes it", sysBefore.row && sysBefore.nameTag === "A" && sysBefore.nameAction === "openLocation", { tag: sysBefore.nameTag, action: sysBefore.nameAction });
  await run(player, P.clearWindows);

  section("13. the Judge sets the pile's default ownership to None");
  const none = await run(gm, P.defaultLevel, { pileUuid, level: 0 });
  levelChanged = true;
  check("13: the default is written None (0) and stored so", none.found && none.level === 0, none);
  const lost = await until(player, P.observes, { uuid: pileUuid }, (v) => v === false);
  check("13: the Player seat no longer reads OBSERVER on the pile", lost === false);
  await run(player, P.openHero, { actorId: heroId });
  const redrawn = await run(player, P.redraw, { actorId: heroId });
  const rowNone = await until(player, P.pileRow, { actorId: heroId, pileUuid }, (r) => r.row && !r.openButton, { tries: 20, every: 300 });
  check("13: the hero's sheet redraws with the pile still listed", redrawn.rendered && rowNone.row, { rendered: redrawn.rendered, row: rowNone.row });
  check("13: the Open control is gone and the name reads as text, on the Equipment tab's row", rowNone.row && !rowNone.openButton && rowNone.nameTag === "SPAN" && rowNone.nameAction === null, { open: rowNone.openButton, tag: rowNone.nameTag, action: rowNone.nameAction });
  check("13: the row's Pick up is still offered (the goods are the Player's)", rowNone.pickUp, { pickUp: rowNone.pickUp });
  await run(player, P.clearWindows);
  const sysNone = await run(player, P.sysStorage, { actorId: heroId, pileUuid });
  check("13: on the system sheet's Storage tab the name reads as text", sysNone.sheetClass && sysNone.row && sysNone.nameTag === "SPAN" && sysNone.nameAction === null, sysNone);
  await run(player, P.clearWindows);

  section("13. the default goes back to Observer");
  const back = await run(gm, P.defaultLevel, { pileUuid, level: foundLevel ?? 2 });
  levelChanged = false;
  check("13: the default is stored as the run found it", back.found && back.level === (foundLevel ?? 2), back);
  const regained = await until(player, P.observes, { uuid: pileUuid }, (v) => v === true);
  check("13: the Player seat reads OBSERVER on the pile again", regained === true);
  await run(player, P.openHero, { actorId: heroId });
  await run(player, P.redraw, { actorId: heroId });
  const rowBack = await until(player, P.pileRow, { actorId: heroId, pileUuid }, (r) => r.row && r.openButton, { tries: 20, every: 300 });
  check("13: the Open control and the link name are back on the row", rowBack.row && rowBack.openButton && rowBack.nameTag === "A" && rowBack.nameAction === "placeOpen", { open: rowBack.openButton, tag: rowBack.nameTag });

  section("teardown step: the Player picks the pack up, which restores the kept fixture");
  const picked = await run(player, P.pressRow, { actorId: heroId, pileUuid, action: "placeRetrieveAll" });
  check("Pick up is pressed on the pile's row", picked.button);
  const after = await until(player, P.restored, { heroId, pileUuid, names: NAMES }, (r) => r.pileGone && r.packOnBack, { tries: 60, every: 300 });
  check("the pack is back on Back with its three goods, one pack only, no set-down record, and the pile is gone", after.packOnBack && after.unmarked && after.packCount === 1 && after.contents?.length === 3 && after.pileGone, after);

  const pe = await run(player, P.drain);
  const ge = await run(gm, P.drain);
  check("no console error or uncaught error on the Player seat over the walk", !pe.errors.length && !pe.uncaught.length, { errors: pe.errors.length, uncaught: pe.uncaught.length });
  check("no console error or uncaught error on the Judge seat over the walk", !ge.errors.length && !ge.uncaught.length, { errors: ge.errors.length, uncaught: ge.uncaught.length });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  // The pile's default is the one write outside the ledger: back to the value found, even where a step threw.
  try {
    if (gm && pileUuid && levelChanged) note("the pile's default put back", await run(gm, P.defaultLevel, { pileUuid, level: foundLevel ?? 2 }));
  } catch (err) { console.error("default restore:", err?.message ?? err); }
  for (const [label, seat] of [["player", player], ["gm", gm]]) {
    try { if (seat) await run(seat, P.clearWindows); } catch (err) { console.error(`close windows ${label}:`, err?.message ?? err); }
  }
  // A pile still holding the hero's goods is emptied back to the hero before the sweep, so the sweep never takes the kept fixture's pack with it.
  try {
    if (gm && pileUuid && heroIdForCleanup) {
      const left = await run(gm, P.recover, { heroId: heroIdForCleanup, pileUuid });
      if (left.found && left.spec) note("the pile still held the hero's goods; they went back to the hero (found, goods, ok)", left);
      await sleep(left.found && left.spec ? 3000 : 0);
    }
  } catch (err) { console.error("pile recover:", err?.message ?? err); }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the pile and its token are named. A pile the Pick up already removed answers "could not find".
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: location/ground-scene, character-sheet/set-down-hero, character-sheet/set-down-hero-token");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  const passed = checks.filter(([, ok]) => ok).length;
  const failed = checks.length - passed;
  console.log(`checks: ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}
