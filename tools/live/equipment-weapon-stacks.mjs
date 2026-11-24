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
 * fold, written by a player who owns the actor. Machine values arrive through
 * ./_env.mjs.
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
  install: async ({ blade, arrival, pack }) => {
    const H = (globalThis.__ws = globalThis.__ws ?? {});
    H.names = { blade, arrival, pack };
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.rows = (actor, name = H.names.blade) =>
      actor.items
        .filter((i) => i.name === name)
        .map((i) => ({ id: i.id, qty: i.system.quantity, eq: !!i.system.equipped, in: i.getFlag("acks-extras", "containedIn") ?? null, thrown: !!i.getFlag("acks-extras", "thrownAway") }));
    // Wait until the rows hold still for three reads in a row, then answer them.
    H.settled = async (actor, name) => {
      let last = "";
      let same = 0;
      for (let n = 0; n < 40 && same < 3; n++) {
        await H.sleep(200);
        const now = JSON.stringify(H.rows(actor, name));
        same = now === last ? same + 1 : 0;
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
    const extra = [...blades.slice(1), ...actor.items.filter((i) => i.name === H.names.arrival)].map((i) => i.id);
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
  setEquipped: async ({ actorId, itemId, on }) => {
    const H = globalThis.__ws;
    const actor = game.actors.get(actorId);
    const answered = await actor.items.get(itemId).update({ "system.equipped": on });
    return { answered: !!answered, rows: await H.settled(actor), load: actor.system.encumbrance?.value ?? null };
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
  drain: async () => ({ errors: globalThis.__ws.errors.slice() }),
  restore: async () => {
    const H = globalThis.__ws;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
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
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 420_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  for (const api of Object.values(seats)) { try { api.close(); } catch {} }
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seats");
  const gm = (seats.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own }));
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install, { blade: BLADE, arrival: ARRIVAL, pack: PACK });
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
  const equipped = await run(gm, P.setEquipped, { actorId, itemId: keepId, on: true });
  check("the row that was equipped is drawn holding one, and a resting row holds two", tookOne(equipped.rows) && drawn(equipped.rows)[0].id === keepId, equipped.rows);
  check("the load the system counts is the same before and after", equipped.load === before.load, { before: before.load, after: equipped.load });

  section("5. putting it away folds the rows");
  const away = await run(gm, P.setEquipped, { actorId, itemId: keepId, on: false });
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
  const seated = await run(player, P.install, { blade: BLADE, arrival: ARRIVAL, pack: PACK });
  check("the Player seat is no GM", !seated.isGM, seated);
  const byPlayer = await run(player, P.setEquipped, { actorId, itemId: keepId, on: true });
  const seenByGm = await run(gm, P.read, { actorId });
  check("a player's equip takes one, and the GM's world holds the same two rows", tookOne(byPlayer.rows) && tookOne(seenByGm.rows), { player: byPlayer.rows, gm: seenByGm.rows });
  const playerAway = await run(player, P.setEquipped, { actorId, itemId: keepId, on: false });
  await sleep(800);
  const foldedForGm = await run(gm, P.read, { actorId });
  check("a player's unequip folds the rows, once, on both seats", oneRowOf(playerAway.rows) && oneRowOf(foldedForGm.rows), { player: playerAway.rows, gm: foldedForGm.rows });

  const drained = [await run(gm, P.drain), await run(player, P.drain)];
  check("no console error on either seat over the walk", drained.every((d) => !d.errors.length), drained.flatMap((d) => d.errors).slice(0, 4));
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
