/**
 * Live walk, combat round: docs/lib/TESTING.md "A player's End Turn starts the
 * next round". A Player seat whose combatant is last in the order presses End
 * Turn; both seats then read the same round, the same order, the same
 * combatant up and the same initiatives, and the round's reset reached the
 * server. The GM's next write of initiatives reaches the player's tracker
 * whole, a value equal to last round's included. The relay refuses a stale
 * round and a seat whose turn it is not, and a refused call leaves the
 * player's tracker as it was. Machine values arrive through ./_env.mjs;
 * nothing here names a port, a world, a seat or a book. Every figure typed
 * into a fixture is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the scene
 * `lib/round-scene`, never activated or viewed; the actors `lib/round-ally`
 * (friendly), `lib/round-foe` (hostile) and `lib/round-pc` (a character the
 * Player seat owns), each with its linked token on the scene
 * (`lib/round-ally-token`, `lib/round-foe-token`, `lib/round-pc-token`) and
 * its row in the unlinked combat `lib/round-combat` (`lib/round-ally-row`,
 * `lib/round-foe-row`, `lib/round-pc-row`). Each section brings them to shape
 * at its start: ownership written whole, dispositions, no status effects, the
 * combat's flags, round, turn and initiatives. The round's announcement is a
 * create path: the message the advance posts, read back by a create observer
 * for the posting seat's own user, is marked `lib/round-message` and retired
 * by the next run before it advances. Writes outside the ledger: the system's
 * initiative-persistence setting, set to reset where it reads keep and
 * restored in the finally.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const browser = MACHINE.browser;
const origin = MACHINE.origin;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const MOD = "acks-extras";
const KEYS = ["ally", "foe", "pc"];

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  census: async (mod) => ({
    foundry: game.version,
    system: game.system.version,
    module: game.modules.get(mod)?.version ?? null,
    user: game.user.name,
    role: game.user.role,
    activeGM: game.users.activeGM?.name ?? null,
    activeGMIsSelf: !!game.users.activeGM?.isSelf,
    active: game.users.filter((u) => u.active).map((u) => u.name),
    socketlib: !!globalThis.socketlib?.modules?.get?.(mod),
    persistence: (() => { try { return game.settings.get("acks", "initiativePersistence"); } catch { return null; } })(),
    skipDefeated: !!game.settings.get("core", "combatTrackerConfig")?.skipDefeated,
    combats: game.combats.map((c) => ({ id: c.id, active: c.active, scene: c.scene?.id ?? null, marker: c.flags?.world?.fixture ?? null })),
  }),

  /** The walk's recorders on this page: refused writes, error toasts, and the messages this seat's user posts. */
  install: async () => {
    const H = (globalThis.__crw = globalThis.__crw ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!H.armed) {
      H.armed = true;
      H.errors = [];
      H.posted = [];
      window.addEventListener("unhandledrejection", (e) => H.errors.push(String(e.reason?.message ?? e.reason)));
      const toast = ui.notifications.error.bind(ui.notifications);
      ui.notifications.error = (msg, opts) => { H.errors.push(`toast: ${String(msg)}`); return toast(msg, opts); };
      Hooks.on("createChatMessage", (msg, _options, userId) => { if (userId === game.user.id) H.posted.push(msg.id); });
    }
    return "installed";
  },

  setPersistence: async ({ value }) => {
    await game.settings.set("acks", "initiativePersistence", value);
    return game.settings.get("acks", "initiativePersistence");
  },

  /** The seat's user id, for an ownership grant. */
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,

  /**
   * The kept fixtures brought to a section's shape: ownership written whole,
   * dispositions, no status effects, the combat's flags, initiatives, round,
   * and the turn on `upKey`'s row.
   */
  shape: async ({ sceneId, actors, tokens, combatId, rows, playerId, inits, round, upKey }) => {
    const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const D = CONST.TOKEN_DISPOSITIONS;
    const scene = game.scenes.get(sceneId);
    await scene.update({ ownership: { default: L.OBSERVER, [game.user.id]: L.OWNER } }, { diff: false, recursive: false });
    for (const [key, id] of Object.entries(actors)) {
      const a = game.actors.get(id);
      const ownership = { default: L.NONE, [game.user.id]: L.OWNER, ...(key === "pc" ? { [playerId]: L.OWNER } : {}) };
      await a.update({ ownership }, { diff: false, recursive: false });
      const marked = a.effects.filter((e) => e.statuses?.size).map((e) => e.id);
      if (marked.length) await a.deleteEmbeddedDocuments("ActiveEffect", marked);
      await scene.tokens.get(tokens[key]).update({ actorLink: true, hidden: false, disposition: key === "foe" ? D.HOSTILE : D.FRIENDLY });
    }
    const combat = game.combats.get(combatId);
    await combat.update({ "flags.acks.initDone": true, "flags.acks.lock-turns": false, "flags.acks.groups": [] });
    await combat.updateEmbeddedDocuments("Combatant", Object.keys(rows).map((k) => ({ _id: rows[k], initiative: inits[k], defeated: false, hidden: false })));
    combat.setupTurns();
    const turn = combat.turns.findIndex((t) => t.id === rows[upKey]);
    await combat.update({ round, turn });
    return { round: combat.round, turn: combat.turn, up: combat.combatant?.id ?? null, order: combat.turns.map((t) => t.id) };
  },

  /** GM: write initiatives (a reroll whose values the walk chooses). */
  writeInits: async ({ combatId, rows, inits }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments("Combatant", Object.entries(inits).map(([k, v]) => ({ _id: rows[k], initiative: v })));
    return Object.fromEntries(combat.combatants.map((c) => [c.id, c._source.initiative]));
  },

  /** GM: put the turn on a row without touching the round. */
  turnTo: async ({ combatId, rowId }) => {
    const combat = game.combats.get(combatId);
    await combat.update({ turn: combat.turns.findIndex((t) => t.id === rowId) });
    return { round: combat.round, turn: combat.turn, up: combat.combatant?.id ?? null };
  },

  /** Open the combat tab on this seat's tracker and view the walk's combat there. */
  view: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    try { ui.sidebar.changeTab("combat", "primary"); } catch {}
    await ui.combat.render({ combat, force: true });
    for (let n = 0; n < 40 && !ui.combat.element?.querySelector?.("li.combatant"); n++) await new Promise((r) => setTimeout(r, 150));
    return { viewed: ui.combat.viewed?.id ?? null, rows: ui.combat.element?.querySelectorAll?.("li.combatant").length ?? 0 };
  },

  /** One seat's reading of the combat, its tracker and its recorders. */
  read: async ({ combatId }) => {
    const H = globalThis.__crw ?? {};
    const c = game.combats.get(combatId);
    const root = ui.combat?.element;
    return {
      user: game.user.name,
      activeGM: game.users.activeGM?.name ?? null,
      round: c?.round ?? null,
      turn: c?.turn ?? null,
      order: c?.turns.map((t) => t.id) ?? [],
      up: c?.combatant?.id ?? null,
      inits: Object.fromEntries((c?.combatants ?? []).map((x) => [x.id, x._source.initiative])),
      tokens: (c?.combatants ?? []).filter((x) => !!x.token).length,
      row: root?.querySelector?.("li.combatant.active")?.dataset?.combatantId ?? null,
      endTurn: !!root?.querySelector?.('.combat-controls [data-action="nextTurn"]'),
      viewed: ui.combat?.viewed?.id ?? null,
      errors: [...(H.errors ?? [])],
      posted: [...(H.posted ?? [])],
    };
  },

  /** Empty this seat's recorders before an action. */
  clear: async () => {
    const H = globalThis.__crw ?? {};
    H.errors = [];
    H.posted = [];
    return "cleared";
  },

  /** The player's real gesture: the tracker's End Turn. */
  endTurn: async () => {
    const button = ui.combat.element?.querySelector?.('.combat-controls [data-action="nextTurn"]');
    if (!button) return { pressed: false, actions: [...(ui.combat.element?.querySelectorAll?.("[data-action]") ?? [])].map((b) => b.dataset.action) };
    button.click();
    return { pressed: true };
  },

  /** The relay called by hand, as a seat's console would, to read its answer. */
  relay: async ({ mod, combatId, round, turn }) => {
    try {
      return { result: (await socketlib.modules.get(mod).executeAsGM("libNextRound", { combatId, round, turn })) ?? null };
    } catch (err) {
      return { threw: String(err?.message ?? err) };
    }
  },

  /** The method a macro or another module would call, on this seat. */
  nextRound: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    try { await combat.nextRound(); return { ok: true }; } catch (err) { return { threw: String(err?.message ?? err) }; }
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
    try {
      ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib && !!ui.combat`);
    } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Poll a seat until `test(reading)` holds, or the time runs out; returns the last reading. */
async function until(api, combatId, test, seconds = 20) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < seconds * 1000) {
    last = await run(api, P.read, { combatId });
    if (test(last)) return last;
    await sleep(500);
  }
  return last;
}

const seats = {};
async function seat(key) {
  const api = await connect({ browser, origin, user: SEATS[key], port: PORTS[key], own: MACHINE.own });
  seats[key] = api;
  note(`${key} ready after (s)`, await ready(api, key));
  return api;
}

let restorePersistence = null;
try {
  section("seats");
  const gm = await seat("gm");
  const gmCensus = await run(gm, P.census, MOD);
  note("gm census", gmCensus);
  check("the GM seat is the active GM and socketlib carries the module", gmCensus.activeGMIsSelf && gmCensus.role === 4 && gmCensus.socketlib, { role: gmCensus.role, module: gmCensus.module });
  if (!gmCensus.activeGMIsSelf) throw new Error("another GM client is the active GM");
  note("install (gm)", await run(gm, P.install));
  if (!["reset", "reroll"].includes(gmCensus.persistence)) {
    restorePersistence = gmCensus.persistence;
    note("initiative persistence set", await run(gm, P.setPersistence, { value: "reset" }));
  }

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: SEATS.player });
  if (!playerId) throw new Error(`no user named ${SEATS.player}`);
  const scene = await gm.fixture("lib/round-scene", "Scene", { name: "Round Walk", width: 1200, height: 800, grid: { size: 100 } });
  const actors = {
    ally: await gm.fixture("lib/round-ally", "Actor", { name: "Round Ally", type: "monster" }),
    foe: await gm.fixture("lib/round-foe", "Actor", { name: "Round Foe", type: "monster" }),
    pc: await gm.fixture("lib/round-pc", "Actor", { name: "Round PC", type: "character" }),
  };
  const tokens = {};
  for (const [n, key] of KEYS.entries()) {
    tokens[key] = await gm.fixture(`lib/round-${key}-token`, "Token", { name: actors[key].name, actorId: actors[key].id, actorLink: true, x: 100 + 200 * n, y: 300 }, { parent: scene.uuid });
  }
  const combat = await gm.fixture("lib/round-combat", "Combat", { scene: null, active: false });
  const rows = {};
  for (const key of KEYS) {
    rows[key] = await gm.fixture(`lib/round-${key}-row`, "Combatant", { tokenId: tokens[key].id, sceneId: scene.id, actorId: actors[key].id }, { parent: combat.uuid });
  }
  const ids = {
    sceneId: scene.id,
    actors: Object.fromEntries(KEYS.map((k) => [k, actors[k].id])),
    tokens: Object.fromEntries(KEYS.map((k) => [k, tokens[k].id])),
    combatId: combat.id,
    rows: Object.fromEntries(KEYS.map((k) => [k, rows[k].id])),
  };
  const nameOf = Object.fromEntries(KEYS.map((k) => [ids.rows[k], k]));
  const named = (r) => r && { ...r, order: r.order.map((id) => nameOf[id] ?? id), up: nameOf[r.up] ?? r.up, row: nameOf[r.row] ?? r.row, inits: r.inits && Object.fromEntries(Object.entries(r.inits).map(([id, v]) => [nameOf[id] ?? id, v])) };
  note("ids", ids);

  section("seats (player)");
  const player = await seat("player");
  const plCensus = await run(player, P.census, MOD);
  note("player census", plCensus);
  check("the Player seat is a player whose active GM is the walk's GM seat", plCensus.role < 3 && plCensus.activeGM === SEATS.gm, { role: plCensus.role, activeGM: plCensus.activeGM });
  if (plCensus.activeGM !== SEATS.gm) throw new Error(`the player's active GM is ${plCensus.activeGM}`);
  note("install (player)", await run(player, P.install));

  section("A player's End Turn starts the next round");
  note("retired lib/round-message", await gm.retire("lib/round-message", "ChatMessage"));
  const shaped = await run(gm, P.shape, { ...ids, playerId, inits: { ally: 6, foe: 4, pc: 1 }, round: 1, upKey: "pc" });
  note("shaped", named(shaped));
  check("the PC's row is up and last in the order, round 1", shaped.round === 1 && shaped.up === ids.rows.pc && shaped.order.at(-1) === ids.rows.pc, named(shaped));
  for (const [key, api] of Object.entries(seats)) note(`viewed (${key})`, await run(api, P.view, { combatId: ids.combatId }));
  const beforePl = await until(player, ids.combatId, (r) => r.up === ids.rows.pc && r.endTurn);
  note("player before", named(beforePl));
  check("the player's tracker shows the PC up, every row's token resolved, and an End Turn control", beforePl.up === ids.rows.pc && beforePl.row === ids.rows.pc && beforePl.tokens === 3 && beforePl.endTurn, { up: nameOf[beforePl.up], row: nameOf[beforePl.row], tokens: beforePl.tokens, endTurn: beforePl.endTurn });
  for (const api of Object.values(seats)) await run(api, P.clear);
  const pressed = await run(player, P.endTurn);
  note("pressed", pressed);
  const gmAfter = await until(gm, ids.combatId, (r) => r.round === 2);
  await sleep(1500);
  const plAfter = await run(player, P.read, { combatId: ids.combatId });
  note("gm after", named(gmAfter));
  note("player after", named(plAfter));
  check("both seats read round 2", gmAfter.round === 2 && plAfter.round === 2, { gm: gmAfter.round, player: plAfter.round });
  check("both seats put the same combatant up", gmAfter.up === plAfter.up && gmAfter.turn === plAfter.turn, { gm: nameOf[gmAfter.up], player: nameOf[plAfter.up] });
  check("both seats hold the same order", same(gmAfter.order, plAfter.order), { gm: named(gmAfter).order, player: named(plAfter).order });
  check("both seats hold the same initiatives", same(gmAfter.inits, plAfter.inits), { gm: named(gmAfter).inits, player: named(plAfter).inits });
  check("the round's reset reached the server: the GM reads every initiative empty", Object.values(gmAfter.inits).every((v) => v === null), named(gmAfter).inits);
  check("the trackers highlight the same row", gmAfter.row === plAfter.row && gmAfter.row !== null, { gm: nameOf[gmAfter.row], player: nameOf[plAfter.row] });
  check("the player's seat recorded no refused write", plAfter.errors.length === 0, plAfter.errors);
  const posted = [...gmAfter.posted, ...plAfter.posted];
  if (posted.length === 1) await gm.mark(`ChatMessage.${posted[0]}`, "lib/round-message");
  else for (const id of posted) gm.track(id, "ChatMessage");
  check("the round is announced once", posted.length === 1, { gm: gmAfter.posted.length, player: plAfter.posted.length });

  section("The GM's next initiatives reach the player's tracker whole");
  // Last round's value for the ally, a new one for the others: a reroll that came up the same.
  const written = await run(gm, P.writeInits, { combatId: ids.combatId, rows: ids.rows, inits: { ally: 6, foe: 3, pc: 2 } });
  note("written", Object.fromEntries(Object.entries(written).map(([id, v]) => [nameOf[id] ?? id, v])));
  const plRolled = await until(player, ids.combatId, (r) => r.inits[ids.rows.foe] === 3 && r.inits[ids.rows.pc] === 2, 10);
  const gmRolled = await run(gm, P.read, { combatId: ids.combatId });
  note("gm rolled", named(gmRolled));
  note("player rolled", named(plRolled));
  check("both seats hold the same initiatives", same(gmRolled.inits, plRolled.inits), { gm: named(gmRolled).inits, player: named(plRolled).inits });
  check("both seats hold the same order and the same combatant up", same(gmRolled.order, plRolled.order) && gmRolled.up === plRolled.up, { gm: named(gmRolled).order, player: named(plRolled).order });

  section("The relay refuses a stale round and a seat whose turn it is not");
  // Refused, the direct call posts nothing; unguarded, it posts an announcement this marker keeps.
  note("retired lib/round-message-out-of-turn", await gm.retire("lib/round-message-out-of-turn", "ChatMessage"));
  for (const api of Object.values(seats)) await run(api, P.clear);
  const stale = await run(player, P.relay, { mod: MOD, combatId: ids.combatId, round: gmRolled.round - 1, turn: gmRolled.turn });
  const gmStale = await run(gm, P.read, { combatId: ids.combatId });
  note("stale", stale);
  check("a request for a round already past is refused as stale, and the round stays", stale.result?.error === "stale" && gmStale.round === gmRolled.round, { answer: stale, round: gmStale.round });
  const moved = await run(gm, P.turnTo, { combatId: ids.combatId, rowId: ids.rows.ally });
  note("turn moved to the ally", { ...moved, up: nameOf[moved.up] });
  const plMoved = await until(player, ids.combatId, (r) => r.up === ids.rows.ally, 10);
  const foreign = await run(player, P.relay, { mod: MOD, combatId: ids.combatId, round: plMoved.round, turn: plMoved.turn });
  note("not the player's turn", foreign);
  check("a request while another's combatant is up is refused", foreign.result?.error === "notYourTurn", foreign);
  const direct = await run(player, P.nextRound, { combatId: ids.combatId });
  await sleep(1500);
  const gmDirect = await run(gm, P.read, { combatId: ids.combatId });
  const plDirect = await run(player, P.read, { combatId: ids.combatId });
  note("direct", direct);
  note("gm after the direct call", named(gmDirect));
  note("player after the direct call", named(plDirect));
  check("the player's own nextRound out of turn changes no round on either seat", gmDirect.round === plMoved.round && plDirect.round === plMoved.round, { gm: gmDirect.round, player: plDirect.round });
  check("and leaves the player's initiatives as the server holds them", same(gmDirect.inits, plDirect.inits) && same(plDirect.inits, plMoved.inits), { gm: named(gmDirect).inits, player: named(plDirect).inits });
  const strays = [...gmDirect.posted, ...plDirect.posted];
  if (strays.length === 1) await gm.mark(`ChatMessage.${strays[0]}`, "lib/round-message-out-of-turn");
  else for (const id of strays) gm.track(id, "ChatMessage");
  check("and posts nothing", strays.length === 0, { gm: gmDirect.posted.length, player: plDirect.posted.length });
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
} finally {
  section("teardown");
  if (restorePersistence !== null && seats.gm) {
    try { note("initiative persistence restored", await run(seats.gm, P.setPersistence, { value: restorePersistence })); } catch (err) { console.error("restore persistence:", err?.message ?? err); }
  }
  for (const key of ["player", "gm"]) {
    const api = seats[key];
    if (!api) continue;
    note(`ledger (${key})`, "");
    try { await api.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
