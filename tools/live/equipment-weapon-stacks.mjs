/**
 * Live walk, equipment-weapon-stacks: a weapon is a stack, and equipping takes
 * one from it. Walks docs/equipment/TESTING.md, "Equipping a stack of
 * weapons", and the arrival steps of docs/lib/TESTING.md, "A weapon or armour
 * is a stack". On the GM seat: an equip of a row of three leaves the clicked
 * row drawn holding one and a resting row of two, by a plain update and by the
 * character sheet's own control; two equips fired together take one; putting
 * the weapon away folds the rows into one of three; a stack inside a container
 * leaves its rest in the container; a thrown weapon recovered folds back; three
 * more of the same thing delivered fold into the resting row, and three of a
 * new thing arrive as one row. On the Player seat: the same equip and the same
 * fold, written by a player who owns the actor. Then, both seats at once: an
 * equip pressed on each in the same moment, and a divide with a different count
 * on each, each leaving one copy and no error shown on the seat that lost; and
 * on the GM seat a divide, the Quantity retyped, and a second divide that must
 * land; the sheet's gear lines naming one item in two places landed twice by the
 * importer's own gear step; and gear carrying an Active Effect of its own
 * delivered as a row for each unit (docs/lib/TESTING.md, stacks, step 7; the
 * market's Buy control and the PDF file read are not pressed). Machine values
 * arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `equipment/weapon-stack`, a character any
 * seat owns, carrying one weapon row and one container. Each run brings it to
 * its start shape before its first check and again at teardown: one loose
 * resting row holding three, and no other row of the walk's two names. Those
 * rows are the fixture's own embedded items and are deleted by id.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKER = "equipment/weapon-stack";
const BLADE = "QA Stack Blade";
const ARRIVAL = "QA Stack Arrival";
const PACK = "QA Stack Pack";
const GLOW = "QA Stack Glow Blade";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

const FIXTURE = {
  name: "Walk: weapon stack",
  type: "character",
  ownership: { default: 3 },
  system: { scores: { str: { value: 12 } } },
  items: [
    { name: BLADE, type: "weapon", system: { quantity: 3, equipped: false, weight6: 6, damage: { base: { formula: "1d6" } } } },
    { name: PACK, type: "item", system: { quantity: 1 }, flags: { "acks-extras": { container: {} } } },
  ],
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ blade, arrival, pack, glow }) => {
    const H = (globalThis.__ws = globalThis.__ws ?? {});
    H.names = { blade, arrival, pack, glow };
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.rows = (actor, name = H.names.blade) =>
      actor.items
        .filter((i) => i.name === name)
        .map((i) => ({ id: i.id, qty: i.system.quantity, eq: !!i.system.equipped, in: i.getFlag("acks-extras", "containedIn") ?? null, thrown: !!i.getFlag("acks-extras", "thrownAway") }));
    // Wait until the rows hold still for three reads in a row, then answer them.
    // A fold is two writes, the count and then the delete, and the first write
    // after a seat loads can take seconds to come back: where the caller knows
    // how many rows the step ends on (`want`), stillness counts only once that
    // many stand, for up to twenty seconds.
    H.settled = async (actor, name, want = null) => {
      let last = "";
      let same = 0;
      for (let n = 0; n < 100 && same < 3; n++) {
        await H.sleep(200);
        const rows = H.rows(actor, name);
        const now = JSON.stringify(rows);
        same = now === last && (want === null || rows.length === want || n >= 96) ? same + 1 : 0;
        last = now;
      }
      return H.rows(actor, name);
    };
    if (game.user.isGM) {
      H.B = await import("/modules/acks-extras/scripts/lib/bundles.mjs");
      H.BL = await import("/modules/acks-extras/scripts/lib/bundles-logic.mjs");
      H.C = await import("/modules/acks-extras/scripts/equipment/containers.mjs");
      H.A = await import("/modules/acks-extras/scripts/equipment/ammo.mjs");
    }
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      // Every notice this seat is shown, so a seat that loses a race can be asked what it displayed.
      H.toasts = [];
      H.notified = { error: ui.notifications.error, warn: ui.notifications.warn };
      for (const kind of ["error", "warn"]) {
        ui.notifications[kind] = function (...args) {
          H.toasts.push([kind, String(args[0]?.message ?? args[0]).slice(0, 200)]);
          return H.notified[kind].apply(this, args);
        };
      }
    }
    return { isGM: game.user.isGM, activeGMIsSelf: !!game.users.activeGM?.isSelf, user: game.user.role };
  },
  /** The start shape: one loose resting blade row holding three, the pack, and nothing else of the walk's names. */
  shape: async ({ actorId }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const blades = actor.items.filter((i) => i.name === H.names.blade && i.type === "weapon");
    const keep = blades[0];
    const pack = actor.items.find((i) => i.name === H.names.pack);
    if (!keep || !pack) return { shaped: false, blade: !!keep, pack: !!pack };
    const extra = [...blades.slice(1), ...actor.items.filter((i) => i.name === H.names.arrival || i.name === H.names.glow)].map((i) => i.id);
    if (extra.length) await actor.deleteEmbeddedDocuments("Item", extra);
    for (const key of ["thrownAway", "containedIn", "hand", "grip", "splitFrom"]) {
      if (keep.getFlag("acks-extras", key) !== undefined) await keep.unsetFlag("acks-extras", key);
    }
    await keep.update({ "system.quantity": 3, "system.equipped": false });
    const rows = await H.settled(actor);
    return { shaped: rows.length === 1 && rows[0].qty === 3 && !rows[0].eq && !rows[0].in, rows, keepId: keep.id, packId: pack.id, deleted: extra.length };
  },
  read: async ({ actorId, name }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    return { rows: H.rows(actor, name), load: actor.system.encumbrance?.value ?? null };
  },
  /** One plain equip or unequip write, as any caller makes it. */
  setEquipped: async ({ actorId, itemId, on, want = null }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const answered = await actor.items.get(itemId).update({ "system.equipped": on });
    return { answered: !!answered, rows: await H.settled(actor, undefined, want), load: actor.system.encumbrance?.value ?? null };
  },
  /** Two equips of one row fired in the same tick: a double click. */
  equipTwice: async ({ actorId, itemId }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    await Promise.all([item.update({ "system.equipped": true }), item.update({ "system.equipped": true })]);
    return { rows: await H.settled(actor) };
  },
  /** The character sheet's own equip control on the row, pressed as a user presses it. */
  press: async ({ actorId, itemId }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    await actor.sheet.render(true);
    let btn = null;
    for (let n = 0; n < 40 && !btn; n++) {
      await H.sleep(250);
      btn = actor.sheet.element?.querySelector?.(`[data-item-id='${itemId}'] button[data-action='toggleEquip']`) ?? null;
    }
    if (!btn) return { found: false, sheet: actor.sheet.constructor.name };
    btn.click();
    return { found: true, sheet: actor.sheet.constructor.name, rows: await H.settled(actor) };
  },
  closeSheet: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    if (actor?.sheet?.rendered) await actor.sheet.close();
    return true;
  },
  store: async ({ actorId, itemId, packId }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    await H.C.storeIn(actor, actor.items.get(itemId), actor.items.get(packId));
    return { rows: await H.settled(actor) };
  },
  throwAway: async ({ actorId, itemId }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    await H.A.markThrown(actor.items.get(itemId));
    return { rows: await H.settled(actor) };
  },
  recover: async ({ actorId }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const names = await H.A.recoverThrown(actor);
    return { names, rows: await H.settled(actor) };
  },
  /** Deliver `count` of the blade, or of a new thing, the way a bundle, a purchase and a kit do. */
  deliver: async ({ actorId, itemId, count, rename }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const data = actor.items.get(itemId).toObject();
    delete data._id;
    if (rename) data.name = rename;
    const goods = H.BL.goodsForRow(data, count);
    const landed = await H.B.deliverItems(actor, goods);
    return { documents: goods.length, created: (landed?.created ?? []).length, updated: (landed?.updated ?? []).length, rows: await H.settled(actor, rename ?? H.names.blade) };
  },
  /** Wait for a wall-clock moment both seats were handed, then act at once: an equip, or a divide of `count` off the stack. */
  fireAt: async ({ actorId, itemId, at, what, count = 1 }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    const M = what === "divide" ? await import("/modules/acks-extras/scripts/lib/item-model.mjs") : null;
    H.toasts.length = 0;
    while (Date.now() < at - 25) await H.sleep(5);
    while (Date.now() < at) { /* spin to the moment */ }
    const lateMs = Date.now() - at;
    let made = null;
    let error = null;
    try {
      made = what === "equip" ? !!(await item.update({ "system.equipped": true })) : !!(await M.divideStack(item, count));
    } catch (err) { error = String(err?.message ?? err).slice(0, 200); }
    return { lateMs, made, error, rows: await H.settled(actor), toasts: H.toasts.slice() };
  },
  /** One divide, as the sheet's control makes it, answered with the copy it made (null where nothing was divided). */
  divideOne: async ({ actorId, itemId, count, want = null }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const M = await import("/modules/acks-extras/scripts/lib/item-model.mjs");
    const made = await M.divideStack(actor.items.get(itemId), count);
    return { made: made?.id ?? null, rows: await H.settled(actor, undefined, want) };
  },
  /** The Quantity field retyped on a row. */
  setQty: async ({ actorId, itemId, qty }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    await actor.items.get(itemId).update({ "system.quantity": qty });
    return { rows: await H.settled(actor) };
  },
  /** The blade rows with the place each is worn at. */
  placed: async ({ actorId }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const W = await import("/modules/acks-extras/scripts/equipment/wear.mjs");
    return H.rows(actor).map((r) => ({ ...r, at: W.wearLocation(actor, actor.items.get(r.id)) ?? null }));
  },
  /** The character sheet's import of its gear lines: the plan read from the sheet's own list boxes, landed by the importer's own gear step. */
  landPlan: async ({ actorId, values }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const A = await import("/modules/acks-extras/scripts/character-sheet/pdf/apply.mjs");
    const PL = await import("/modules/acks-extras/scripts/character-sheet/pdf/plan.mjs");
    const report = { checks: [], granted: [], notes: [], unmatched: [] };
    const plan = PL.buildPlan(values);
    await A.landGear(actor, plan.gear, report);
    await H.settled(actor);
    const W = await import("/modules/acks-extras/scripts/equipment/wear.mjs");
    const rows = H.rows(actor).map((r) => ({ ...r, at: W.wearLocation(actor, actor.items.get(r.id)) ?? null }));
    return { lines: plan.gear.map((g) => [g.place, g.qty, g.name]), granted: report.granted.length, checks: report.checks.length, rows };
  },
  /** Deliver `count` of a weapon carrying an Active Effect of its own, through the delivery a purchase, a bundle drop and a sheet import share. */
  deliverGlow: async ({ actorId, count }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const data = { name: H.names.glow, type: "weapon", img: "icons/svg/sword.svg", system: { quantity: 1, equipped: false, weight6: 6, damage: { base: { formula: "1d6" } } }, effects: [{ name: "QA Stack Glow", img: "icons/svg/aura.svg", changes: [], disabled: false }] };
    const goods = H.BL.goodsForRow(data, count);
    const landed = await H.B.deliverItems(actor, goods);
    const rows = await H.settled(actor, H.names.glow, count);
    return { documents: goods.length, created: (landed?.created ?? []).length, updated: (landed?.updated ?? []).length, rows, effects: actor.items.filter((i) => i.name === H.names.glow).map((i) => i.effects.size) };
  },
  drain: async () => ({ errors: globalThis.__ws.errors.slice(), toasts: globalThis.__ws.toasts.slice() }),
  restore: async () => {
    const H = globalThis.__ws;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    ui.notifications.error = H.notified.error;
    ui.notifications.warn = H.notified.warn;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const drawn = (rows) => rows.filter((r) => r.eq);
const resting = (rows) => rows.filter((r) => !r.eq);
const total = (rows) => rows.reduce((n, r) => n + Number(r.qty ?? 0), 0);
/** One drawn row holding one, one resting row holding the rest, and nothing else. */
const tookOne = (rows, of = 3) => rows.length === 2 && drawn(rows).length === 1 && drawn(rows)[0].qty === 1 && resting(rows)[0].qty === of - 1 && total(rows) === of;
const oneRowOf = (rows, of = 3) => rows.length === 1 && rows[0].qty === of && !rows[0].eq;

const seats = {};
let actorId = null;
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 720_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  for (const api of Object.values(seats)) { try { api.close(); } catch {} }
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  const gm = (seats.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own }));
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install, { blade: BLADE, arrival: ARRIVAL, pack: PACK, glow: GLOW });
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, installed);

  section("fixture");
  const fixture = await gm.fixture(MARKER, "Actor", FIXTURE);
  actorId = fixture.id ?? String(fixture.uuid).split(".").pop();
  let start = await run(gm, P.shape, { actorId });
  check("shape: one loose resting row holding three", start.shaped, start);
  const keepId = start.keepId;
  const packId = start.packId;
  const before = await run(gm, P.read, { actorId });

  section("1. an equip of a row of three takes one");
  const equipped = await run(gm, P.setEquipped, { actorId, itemId: keepId, on: true, want: 2 });
  check("the row that was equipped is drawn holding one, and a resting row holds two", tookOne(equipped.rows) && drawn(equipped.rows)[0].id === keepId, equipped.rows);
  check("the load the system counts is the same before and after", equipped.load === before.load, { before: before.load, after: equipped.load });

  section("5. putting it away folds the rows");
  const away = await run(gm, P.setEquipped, { actorId, itemId: keepId, on: false, want: 1 });
  check("one row holds three again, and it is the row that was handled", oneRowOf(away.rows) && away.rows[0].id === keepId, away.rows);

  section("1. the character sheet's own control");
  const pressed = await run(gm, P.press, { actorId, itemId: keepId });
  check("the equip control on the row of three takes one", pressed.found && tookOne(pressed.rows) && drawn(pressed.rows)[0].id === keepId, pressed);
  const pressedBack = await run(gm, P.press, { actorId, itemId: keepId });
  check("the same control puts it away, and the rows fold into three", pressedBack.found && oneRowOf(pressedBack.rows), pressedBack);
  await run(gm, P.closeSheet, { actorId });

  section("2. two equips fired together");
  start = await run(gm, P.shape, { actorId });
  const twice = await run(gm, P.equipTwice, { actorId, itemId: keepId });
  check("a double equip takes one off the stack, once", tookOne(twice.rows), twice.rows);

  section("6. thrown and recovered");
  const thrown = await run(gm, P.throwAway, { actorId, itemId: keepId });
  check("a drawn weapon thrown away stays a row of its own beside the two", thrown.rows.length === 2 && thrown.rows.some((r) => r.thrown && r.qty === 1) && total(thrown.rows) === 3, thrown.rows);
  const recovered = await run(gm, P.recover, { actorId });
  check("recovered, it folds back: one row of three", oneRowOf(recovered.rows) && recovered.names.length === 1, recovered);

  section("3. a stack inside a container");
  start = await run(gm, P.shape, { actorId });
  const stored = await run(gm, P.store, { actorId, itemId: keepId, packId });
  check("the stack of three is in the pack", stored.rows.length === 1 && stored.rows[0].in === packId && stored.rows[0].qty === 3, stored.rows);
  const fromPack = await run(gm, P.setEquipped, { actorId, itemId: keepId, on: true });
  check("the one drawn leaves the pack, and the two left stay in it", tookOne(fromPack.rows) && drawn(fromPack.rows)[0].in === null && resting(fromPack.rows)[0].in === packId, fromPack.rows);
  const sheathed = await run(gm, P.setEquipped, { actorId, itemId: keepId, on: false });
  check("put away, the one is loose and the two are still packed: nothing is lost and nothing folds across the pack", sheathed.rows.length === 2 && total(sheathed.rows) === 3 && sheathed.rows.filter((r) => r.in === packId).length === 1, sheathed.rows);

  section("arrivals fold");
  start = await run(gm, P.shape, { actorId });
  const more = await run(gm, P.deliver, { actorId, itemId: keepId, count: 3 });
  check("three more of the same thing are one document, and fold into the resting row: one row of six", more.documents === 1 && oneRowOf(more.rows, 6), more);
  const fresh = await run(gm, P.deliver, { actorId, itemId: keepId, count: 3, rename: ARRIVAL });
  check("three of a new thing arrive as one row holding three", fresh.documents === 1 && fresh.created === 1 && oneRowOf(fresh.rows), fresh);

  section("the Player seat");
  start = await run(gm, P.shape, { actorId });
  const player = (seats.player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own }));
  note("player ready after (s)", await ready(player, "player"));
  const seated = await run(player, P.install, { blade: BLADE, arrival: ARRIVAL, pack: PACK, glow: GLOW });
  check("the Player seat is no GM", !seated.isGM, seated);
  const byPlayer = await run(player, P.setEquipped, { actorId, itemId: keepId, on: true });
  const seenByGm = await run(gm, P.read, { actorId });
  check("a player's equip takes one, and the GM's world holds the same two rows", tookOne(byPlayer.rows) && tookOne(seenByGm.rows), { player: byPlayer.rows, gm: seenByGm.rows });
  const playerAway = await run(player, P.setEquipped, { actorId, itemId: keepId, on: false });
  await sleep(800);
  const foldedForGm = await run(gm, P.read, { actorId });
  check("a player's unequip folds the rows, once, on both seats", oneRowOf(playerAway.rows) && oneRowOf(foldedForGm.rows), { player: playerAway.rows, gm: foldedForGm.rows });

  /* ---------------------------------------------------------------- */
  /*  Two seats at once, a retyped Quantity, a sheet's gear lines, and    */
  /*  gear with effects of its own (docs/lib/TESTING.md, stacks, step 7)  */
  /* ---------------------------------------------------------------- */
  const byId = (rows) => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)));
  const errorToasts = (r) => r.toasts.filter(([kind]) => kind === "error");

  section("7. two seats equip one stack of 3 in the same moment");
  start = await run(gm, P.shape, { actorId });
  check("shape: one loose resting row holding three", start.shaped, start);
  const atEquip = Date.now() + 2500;
  const [equipGm, equipPlayer] = await Promise.all([
    run(gm, P.fireAt, { actorId, itemId: keepId, at: atEquip, what: "equip" }),
    run(player, P.fireAt, { actorId, itemId: keepId, at: atEquip, what: "equip" }),
  ]);
  await sleep(2000);
  const equipRowsGm = (await run(gm, P.read, { actorId })).rows;
  const equipRowsPlayer = (await run(player, P.read, { actorId })).rows;
  note("equip race: ms late, wrote, error, notices shown, per seat", { gm: [equipGm.lateMs, equipGm.made, equipGm.error, equipGm.toasts], player: [equipPlayer.lateMs, equipPlayer.made, equipPlayer.error, equipPlayer.toasts] });
  check("both equips landed one drawn row of one and one resting row of two, three in all", tookOne(equipRowsGm), equipRowsGm);
  check("the two seats read the same rows", byId(equipRowsGm) === byId(equipRowsPlayer), { gm: equipRowsGm, player: equipRowsPlayer });
  check("neither seat threw an error or was shown an error notice", !equipGm.error && !equipPlayer.error && !errorToasts(equipGm).length && !errorToasts(equipPlayer).length, { gm: [equipGm.error, equipGm.toasts], player: [equipPlayer.error, equipPlayer.toasts] });

  section("7. two seats divide one stack of 3 in the same moment, with different counts");
  start = await run(gm, P.shape, { actorId });
  check("shape: one loose resting row holding three", start.shaped, start);
  const atDivide = Date.now() + 2500;
  const [divGm, divPlayer] = await Promise.all([
    run(gm, P.fireAt, { actorId, itemId: keepId, at: atDivide, what: "divide", count: 1 }),
    run(player, P.fireAt, { actorId, itemId: keepId, at: atDivide, what: "divide", count: 2 }),
  ]);
  await sleep(2000);
  const divRowsGm = (await run(gm, P.read, { actorId })).rows;
  const divRowsPlayer = (await run(player, P.read, { actorId })).rows;
  note("divide race: ms late, made a copy, error, notices shown, per seat", { gm: [divGm.lateMs, divGm.made, divGm.error, divGm.toasts], player: [divPlayer.lateMs, divPlayer.made, divPlayer.error, divPlayer.toasts] });
  check("one divide stood: two rows holding the three between them, one of one and one of two", divRowsGm.length === 2 && total(divRowsGm) === 3 && divRowsGm.map((r) => r.qty).sort().join() === "1,2", divRowsGm);
  check("exactly one seat made a copy, and the other wrote nothing", [divGm.made, divPlayer.made].filter(Boolean).length === 1, { gm: divGm.made, player: divPlayer.made });
  check("the two seats read the same rows", byId(divRowsGm) === byId(divRowsPlayer), { gm: divRowsGm, player: divRowsPlayer });
  check("neither seat threw an error or was shown an error notice", !divGm.error && !divPlayer.error && !errorToasts(divGm).length && !errorToasts(divPlayer).length, { gm: [divGm.error, divGm.toasts], player: [divPlayer.error, divPlayer.toasts] });

  section("7. divide, retype the Quantity, divide again");
  start = await run(gm, P.shape, { actorId });
  check("shape: one loose resting row holding three", start.shaped, start);
  const firstCut = await run(gm, P.divideOne, { actorId, itemId: keepId, count: 1, want: 2 });
  check("the first divide made a row of one beside the row of two", !!firstCut.made && firstCut.rows.length === 2 && firstCut.rows.map((r) => r.qty).sort().join() === "1,2", firstCut);
  const retyped = await run(gm, P.setQty, { actorId, itemId: keepId, qty: 3 });
  check("the Quantity retyped to three reads three on the stack and leaves the row of one", retyped.rows.length === 2 && retyped.rows.find((r) => r.id === keepId)?.qty === 3, retyped.rows);
  const secondCut = await run(gm, P.divideOne, { actorId, itemId: keepId, count: 1, want: 3 });
  check("the second divide landed: a third row, of one, with its own id", !!secondCut.made && secondCut.made !== firstCut.made && secondCut.rows.length === 3 && secondCut.rows.filter((r) => r.qty === 1).length === 2 && secondCut.rows.find((r) => r.id === keepId)?.qty === 2, secondCut);

  section("7. a character sheet's gear lines naming one item in two places, imported twice");
  start = await run(gm, P.shape, { actorId });
  await run(gm, P.setQty, { actorId, itemId: keepId, qty: 2 });
  const bothHands = { "gear.mainHand.list": BLADE, "gear.offHand.list": BLADE };
  const inBothHands = await run(gm, P.landPlan, { actorId, values: bothHands });
  check("the plan reads one line for each hand", inBothHands.lines.length === 2 && inBothHands.lines.map((l) => l[0]).sort().join() === "mainHand,offHand", inBothHands.lines);
  check("one in each hand: two drawn rows of one, at two different hands, nothing lost", inBothHands.rows.length === 2 && inBothHands.rows.every((r) => r.eq && r.qty === 1 && r.at) && new Set(inBothHands.rows.map((r) => r.at)).size === 2, inBothHands.rows);
  const againBoth = await run(gm, P.landPlan, { actorId, values: bothHands });
  check("imported again, nothing moves and nothing is granted", byId(againBoth.rows) === byId(inBothHands.rows) && againBoth.granted === 0, againBoth);
  start = await run(gm, P.shape, { actorId });
  await run(gm, P.setQty, { actorId, itemId: keepId, qty: 2 });
  const handAndPack = { "gear.mainHand.list": BLADE, "gear.backpack.list": BLADE };
  const inHandAndPack = await run(gm, P.landPlan, { actorId, values: handAndPack });
  check("one in a hand and one in the pack: a drawn row of one in a hand and a row of one stored in the pack", inHandAndPack.rows.length === 2 && inHandAndPack.rows.filter((r) => r.eq && !r.in && r.qty === 1 && r.at).length === 1 && inHandAndPack.rows.filter((r) => !r.eq && r.in === packId && r.qty === 1).length === 1, inHandAndPack.rows);
  const againPack = await run(gm, P.landPlan, { actorId, values: handAndPack });
  check("imported again, nothing moves and nothing is granted", byId(againPack.rows) === byId(inHandAndPack.rows) && againPack.granted === 0, againPack);

  section("7. gear carrying an Active Effect of its own arrives as a row for each unit");
  start = await run(gm, P.shape, { actorId });
  const glow = await run(gm, P.deliverGlow, { actorId, count: 3 });
  check("three arrive as three documents, three rows of one, each carrying its effect, none folded", glow.documents === 3 && glow.rows.length === 3 && glow.rows.every((r) => r.qty === 1 && !r.eq) && glow.effects.every((n) => n === 1), glow);
  const glowEquip = await run(gm, P.setEquipped, { actorId, itemId: glow.rows[0].id, on: true });
  const glowRows = (await run(gm, P.read, { actorId, name: GLOW })).rows;
  check("each equips alone: one drawn, the other two rows still of one, three rows in all", !!glowEquip.answered && glowRows.length === 3 && glowRows.filter((r) => r.eq).length === 1 && glowRows.every((r) => r.qty === 1), glowRows);
  const glowMore = await run(gm, P.deliverGlow, { actorId, count: 1 });
  check("one more arrives as a fourth row, folded into none", glowMore.rows.length === 4 && glowMore.rows.every((r) => r.qty === 1), glowMore.rows);
  note("not pressed", "the market's Buy control and the PDF file read; the delivery and the plan that the Buy, a bundle drop and the import share were driven");

  const drained = [await run(gm, P.drain), await run(player, P.drain)];
  check("no console error on either seat over the walk", drained.every((d) => !d.errors.length), drained.flatMap((d) => d.errors).slice(0, 4));
  note("every notice shown over the walk, gm then player", drained.map((d) => d.toasts));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  const gm = seats.gm;
  if (gm && actorId) {
    try { await run(gm, P.closeSheet, { actorId }); note("start shape restored", await run(gm, P.shape, { actorId })); } catch (err) { console.error("shape restore:", err?.message ?? err); }
  }
  for (const api of Object.values(seats)) {
    try { note("restored", await run(api, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  }
  console.log(`fixture kept: ${MARKER}`);
  for (const api of Object.values(seats)) { try { await api.close(); } catch {} }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
