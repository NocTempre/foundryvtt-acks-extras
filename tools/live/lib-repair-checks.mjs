/**
 * Live walk, lib-repair-checks: the two-handed row repair check, and tied
 * initiative sorted the same on both seats. Walks docs/lib/TESTING.md:
 *   - "A weapon's two-handed die, and the check that writes it", steps 1–4;
 *   - "Tied initiative sorts the same on every seat", steps 1, 2, 3, 5 and 6.
 * Machine values arrive through ./_env.mjs. No book is needed: every name and
 * die is invented, and the weapon rows are the stamped modes built by hand.
 *
 * Fixtures, kept and found by marker: `lib/two-handed-row`,
 * `lib/two-handed-row-none`, `lib/two-handed-row-free`, the character
 * `lib/two-handed-row-bearer` and its weapon `lib/two-handed-row-bearer-copy`;
 * the scene `lib/turn-order-scene` and the combats `lib/turn-order-combat` and
 * `lib/turn-order-combat-reversed`. A kept combat is read as it stands, rows,
 * tokens and sides from whoever built it, and the census prints their markers;
 * only a combat this run builds gets the monsters `lib/turn-order-a` to `-d`,
 * their tokens `lib/turn-order-<x>-token` and rows `lib/turn-order-<x>-row`.
 * The reversed combat's rows, `lib/turn-order-row-<n>-reversed`, are the kept
 * combat's tokens in reverse. Each step writes the shape it needs first. The
 * run's own products (the repair report's whisper) are tracked and swept; the
 * fixtures stay. `LEAVINGS=<json file>` names uuids a run that died before its
 * sweep tracked (read off its log), and they are swept first.
 */
import fs from "node:fs";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const MELEE = { key: "melee", label: "Melee", damage: "1d7", attack: "melee" };
const TWO = { key: "melee-twohanded", label: "Two-handed melee", damage: "1d11", attack: "melee", grip: "two-handed" };
const weapon = (name, modes) => ({
  name, type: "weapon",
  system: { damage: { base: { formula: "1d7" }, alternate: { formula: "1d5" } } },
  flags: modes ? { "acks-extras": { weapon: { modes } } } : {},
});

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__lrBoot = { phase: "load", phases: [], errors: [] });
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

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__lr = globalThis.__lr ?? {});
    H.RP = await import("/modules/acks-extras/scripts/lib/repair.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 80, every = 200 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => { const el = app?.element; return el?.nodeType === 1 ? el : (el?.[0] ?? null); };
    if (!H.chatHook) {
      H.posted = [];
      H.chatHook = Hooks.on("createChatMessage", (m) => { if (H.catching && m.author?.isSelf) H.posted.push(m.id); });
    }
    return {
      user: game.user.name, isGM: game.user.isGM, role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      libWrapper: !!game.modules.get("lib-wrapper")?.active,
      boot: globalThis.__lrBoot ?? null,
    };
  },
  alternate: async ({ uuid, formula }) => {
    const item = await fromUuid(uuid);
    await item.update({ "system.damage.alternate.formula": formula });
    return (await fromUuid(uuid)).system.damage.alternate.formula;
  },
  read: async ({ uuid }) => {
    const item = await fromUuid(uuid);
    return item ? { alternate: item.system?.damage?.alternate?.formula ?? null, base: item.system?.damage?.base?.formula ?? null } : null;
  },
  scan: async ({ uuids }) => {
    const [res] = await globalThis.__lr.RP.scanRepairs({ only: "lib.twoHandedRow" });
    const mine = (res?.findings ?? []).filter((f) => uuids.includes(f.key));
    return {
      error: res?.error ?? null,
      total: res?.findings?.length ?? 0,
      mine: mine.map((f) => ({ uuid: f.key, fixable: f.fixable !== false, want: f.want, detail: f.detail })),
      want: {
        stores: game.i18n.format("ACKS-LIB.repair.check.twoHandedRow.detail", { stored: "1d5", row: "1d11" }),
        none: game.i18n.format("ACKS-LIB.repair.check.twoHandedRow.detail", { stored: "1d5", row: game.i18n.localize("ACKS-LIB.repair.check.twoHandedRow.none") }),
      },
    };
  },
  /** The repair window, scanning this check; the fixtures' rows ticked and Fix selected pressed. */
  windowFix: async ({ uuids }) => {
    const H = globalThis.__lr;
    const app = acksExtras.lib.repair.open({ only: "lib.twoHandedRow", scan: true });
    const table = await H.poll(() => app.rendered && H.root(app)?.querySelector("[data-check='lib.twoHandedRow'] .acks-extras-repair-findings"), { tries: 150 });
    if (!table) return { table: false };
    const root = H.root(app);
    const rows = {};
    let ticked = 0;
    for (const uuid of uuids) {
      const box = root.querySelector(`input[data-pick='lib.twoHandedRow|${uuid}']`);
      const tr = box?.closest("tr");
      rows[uuid] = tr ? tr.querySelector("td:last-child")?.textContent.replace(/\s+/g, " ").trim() ?? null : null;
      if (box) { box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); ticked++; }
    }
    const go = await H.poll(() => { const b = H.root(app)?.querySelector("[data-action='fixSelected']"); return b && !b.disabled ? b : null; });
    if (!go) return { table: true, ticked, rows, enabled: false };
    H.posted = [];
    H.catching = true;
    const before = [...foundry.applications.instances.keys()];
    go.click();
    // Fix selected asks first; Yes, as a Judge answers.
    const ask = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.includes(a.id) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.querySelector("button[data-action='yes']")));
    if (!ask) { H.catching = false; return { table: true, ticked, rows, asked: false }; }
    H.root(ask).querySelector("button[data-action='yes']").click();
    const outcome = await H.poll(() => H.root(app)?.querySelector("[data-check='lib.twoHandedRow'] .acks-extras-repair-outcome"), { tries: 150 });
    await H.sleep(800);
    H.catching = false;
    const counts = outcome?.querySelector("p")?.textContent.trim() ?? null;
    const still = uuids.filter((u) => H.root(app)?.querySelector(`input[data-pick='lib.twoHandedRow|${u}']`));
    await app.close({ animate: false });
    const report = H.posted.map((id) => game.messages.get(id)).filter(Boolean);
    return {
      table: true, ticked, rows, counts, still, posted: H.posted.slice(),
      reportWhisper: report.length === 1 && report[0].whisper.length > 0,
    };
  },
  sheet: async ({ uuid }) => {
    const H = globalThis.__lr;
    const item = await fromUuid(uuid);
    await item.sheet.render(true);
    const input = await H.poll(() => H.root(item.sheet)?.querySelector("[name='system.damage.alternate.formula']"));
    const out = { found: !!input, value: input?.value ?? null };
    await item.sheet.close({ animate: false });
    return out;
  },

  /** Bring a combat and its rows to the shape the steps start from. */
  shapeCombat: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments("Combatant", combat.combatants.map((c) => ({ _id: c.id, initiative: 4, defeated: false, "flags.acks.-=outnumbering": null })));
    // End Turn skips a surprised or defeated row in round 1, so none is either.
    const cleared = [];
    for (const c of combat.combatants) {
      for (const status of ["surprised", CONFIG.specialStatusEffects.DEFEATED]) {
        if (c.actor?.statuses?.has(status)) { await c.actor.toggleStatusEffect(status, { active: false }); cleared.push(status); }
      }
    }
    // The turn last: core keeps the current combatant current when a row's
    // initiative changes, so a turn written before the rows moves with them.
    await combat.update({ "flags.acks.initDone": true, "flags.acks.-=lock-turns": null, round: 1, turn: 0 });
    return cleared;
  },
  setRows: async ({ combatId, rows }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments("Combatant", rows);
    return true;
  },
  turns: async ({ combatId, setup }) => {
    const combat = game.combats.get(combatId);
    if (!combat) return { visible: false };
    let threw = null;
    let returned = null;
    if (setup) {
      try { returned = combat.setupTurns()?.map((t) => t.id) ?? null; } catch (err) { threw = String(err?.message ?? err); }
    }
    return { visible: true, turns: combat.turns.map((t) => t.id), returned, threw, turn: combat.turn, current: combat.combatant?.id ?? null };
  },
  rows: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    return combat.combatants.map((c) => ({ id: c.id, tokenId: c.tokenId, hostile: c.token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE, outnumbering: !!c.flags?.acks?.outnumbering, initiative: c.initiative, defeated: c.isDefeated, surprised: !!c.actor?.statuses?.has("surprised") }));
  },
  /** Who built the kept combat's rows: each row's marker, its token's and its actor's, and whether the token stands on the kept scene. */
  census: async ({ combatId, sceneId }) => {
    const combat = game.combats.get(combatId);
    return {
      rows: combat.combatants.map((c) => ({
        id: c.id, tokenId: c.tokenId, sceneId: c.sceneId, actorId: c.actorId,
        marker: c.flags?.world?.fixture ?? null, tokenMarker: c.token?.flags?.world?.fixture ?? null,
        actorMarker: c.actor?.flags?.world?.fixture ?? null, onScene: c.sceneId === sceneId && !!c.token,
      })),
    };
  },
  /** Another engine's sort: an insertion sort calling the comparator as (later, earlier). */
  otherSort: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    const original = Array.prototype.sort;
    let out;
    try {
      Array.prototype.sort = function (cmp) {
        const a = this;
        for (let i = 1; i < a.length; i++) {
          const x = a[i];
          let j = i - 1;
          while (j >= 0 && cmp(x, a[j]) < 0) { a[j + 1] = a[j]; j--; }
          a[j + 1] = x;
        }
        return a;
      };
      combat.setupTurns();
    } finally {
      Array.prototype.sort = original;
    }
    out = combat.turns.map((t) => t.id);
    return out;
  },
  nextTurn: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    await combat.nextTurn();
    return { turn: combat.turn, current: combat.combatant?.id ?? null };
  },
  restore: async () => {
    const H = globalThis.__lr;
    if (!H) return "never installed";
    if (H.chatHook) { Hooks.off("createChatMessage", H.chatHook); H.chatHook = null; }
    return "restored";
  },
};

async function run(api, fn, arg) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}
async function until(api, fn, arg, test, { tries = 40, every = 250 } = {}) {
  let value;
  for (let n = 0; n < tries; n++) {
    value = await run(api, fn, arg);
    if (test(value)) return value;
    await sleep(every);
  }
  return value;
}
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.repair`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 500000;
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
  const seconds = await ready(api, label);
  ws.close();
  return seconds;
}

let gm = null;
let player = null;
const swept = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 570_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();
try {
  section("seats");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: SEATS.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await record(PORTS.gm, "gm", gm));
  note("player ready after (s)", await record(PORTS.player, "player", player));
  const g = await run(gm, P.install);
  const p = await run(player, P.install);
  note("installed", { gm: g.user, player: p.user, libWrapper: g.libWrapper });
  check("the GM seat is the active GM, and the player seat is a player", g.isGM && g.activeGMIsSelf && !p.isGM, { gm: g.role, player: p.role });
  if (!g.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  for (const [key, c] of Object.entries({ gm: g, player: p })) check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  // A run that died before its sweep: LEAVINGS names a JSON file of the uuids its log tracked.
  if (process.env.LEAVINGS) {
    const leavings = JSON.parse(fs.readFileSync(process.env.LEAVINGS, "utf8"));
    const only = leavings.map((u) => gm.track(u));
    const sw = await gm.sweepTracked({ only });
    note("leavings swept", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
  }

  section("A weapon's two-handed die: fixtures");
  const first = await gm.fixture("lib/two-handed-row", "Item", weapon("QA Greatblade", [MELEE, TWO]));
  const none = await gm.fixture("lib/two-handed-row-none", "Item", weapon("QA Shortblade", [MELEE]));
  const free = await gm.fixture("lib/two-handed-row-free", "Item", weapon("QA Freeblade", null));
  const bearer = await gm.fixture("lib/two-handed-row-bearer", "Actor", { name: "QA Bearer", type: "character", items: [] });
  const copy = await gm.fixture("lib/two-handed-row-bearer-copy", "Item", weapon("QA Greatblade", [MELEE, TWO]), { parent: bearer.uuid });
  const fixed = [first.uuid, none.uuid, copy.uuid];
  for (const u of [...fixed, free.uuid]) await run(gm, P.alternate, { uuid: u, formula: "1d5" });

  section("A weapon's two-handed die: 1. the scan");
  const scan = await run(gm, P.scan, { uuids: [...fixed, free.uuid] });
  note("scan", { total: scan.total, mine: scan.mine.map((f) => ({ fixable: f.fixable, want: f.want })) });
  const byUuid = Object.fromEntries(scan.mine.map((f) => [f.uuid, f]));
  check("1: the first, the second and the bearer's copy are listed, each fixable; the free weapon is absent", fixed.every((u) => byUuid[u]?.fixable) && !byUuid[free.uuid], Object.keys(byUuid).length);
  check("1: the first's detail reads stores 1d5, row 1d11, and the second's names none for the row", byUuid[first.uuid]?.detail === scan.want.stores && byUuid[none.uuid]?.detail === scan.want.none && byUuid[copy.uuid]?.detail === scan.want.stores);
  check("1: the finding carries the die to write: the row's, or blank", byUuid[first.uuid]?.want === "1d11" && byUuid[none.uuid]?.want === "" && byUuid[copy.uuid]?.want === "1d11");

  section("A weapon's two-handed die: 2. the window");
  const win = await run(gm, P.windowFix, { uuids: fixed });
  for (const id of win.posted ?? []) swept.push(gm.track(id, "ChatMessage"));
  note("window", { ticked: win.ticked, counts: win.counts, still: win.still?.length, posted: win.posted?.length });
  check("2: each fixture's row names its stored die and its row's die", win.table && win.rows[first.uuid] === scan.want.stores && win.rows[none.uuid] === scan.want.none && win.rows[copy.uuid] === scan.want.stores, win.rows && Object.values(win.rows).map((r) => !!r));
  check("2: Fix selected on the three, a whispered report, and the rescan lists none of them", win.ticked === 3 && win.reportWhisper && win.still.length === 0, { ticked: win.ticked, whisper: win.reportWhisper, still: win.still?.length });
  const rescan = await run(gm, P.scan, { uuids: [...fixed, free.uuid] });
  check("2: a fresh scan lists none of the fixtures", rescan.mine.length === 0, rescan.mine.length);

  section("A weapon's two-handed die: 3. the write");
  const back = {};
  for (const u of [...fixed, free.uuid]) back[u] = await run(gm, P.read, { uuid: u });
  note("read back", Object.values(back));
  check("3: the first and the bearer's copy store 1d11, the second blank, the free weapon still 1d5", back[first.uuid].alternate === "1d11" && back[copy.uuid].alternate === "1d11" && back[none.uuid].alternate === "" && back[free.uuid].alternate === "1d5");
  check("3: no other field moved: the base die is still 1d7 on every one", Object.values(back).every((b) => b.base === "1d7"));

  section("A weapon's two-handed die: 4. the sheet");
  const s1 = await run(gm, P.sheet, { uuid: first.uuid });
  const s2 = await run(gm, P.sheet, { uuid: none.uuid });
  note("sheets", { first: s1, second: s2 });
  check("4: the first weapon's alternate damage field reads 1d11, the second's reads empty", s1.found && s1.value === "1d11" && s2.found && s2.value === "", { first: s1, second: s2 });

  section("Tied initiative: fixtures");
  // The kept combat is read as it stands: its rows' ids, tokens and sides are
  // what the steps use, whoever built them. Only a combat this run builds is
  // given the monsters, tokens and rows below.
  const scene = await gm.fixture("lib/turn-order-scene", "Scene", { name: "QA Turn Order", width: 1000, height: 600, grid: { size: 100 }, ownership: { default: 2 } });
  const combat = await gm.fixture("lib/turn-order-combat", "Combat", { scene: null });
  if (combat.built) {
    const SIDES = { a: -1, b: -1, c: 1, d: 1 };
    let x = 100;
    for (const [k, disposition] of Object.entries(SIDES)) {
      const actor = await gm.fixture(`lib/turn-order-${k}`, "Actor", { name: `QA Tie ${k.toUpperCase()}`, type: "monster", items: [], prototypeToken: { actorLink: true, disposition } });
      const token = await gm.fixture(`lib/turn-order-${k}-token`, "Token", { name: `QA Tie ${k.toUpperCase()}`, actorId: actor.id, actorLink: true, disposition, x, y: 100 }, { parent: scene.uuid });
      await gm.fixture(`lib/turn-order-${k}-row`, "Combatant", { tokenId: token.id, sceneId: scene.id, actorId: actor.id }, { parent: combat.uuid });
      x += 100;
    }
  }
  const census = await run(gm, P.census, { combatId: combat.id, sceneId: scene.id });
  note("kept combat", census);
  const rows = await run(gm, P.rows, { combatId: combat.id });
  const reversed = await gm.fixture("lib/turn-order-combat-reversed", "Combat", { scene: null });
  if (reversed.built) {
    for (const [n, r] of [...census.rows].reverse().entries()) {
      await gm.fixture(`lib/turn-order-row-${n + 1}-reversed`, "Combatant", { tokenId: r.tokenId, sceneId: r.sceneId, actorId: r.actorId }, { parent: reversed.uuid });
    }
  }
  note("shape cleared", { combat: await run(gm, P.shapeCombat, { combatId: combat.id }), reversed: await run(gm, P.shapeCombat, { combatId: reversed.id }) });
  const shaped = await run(gm, P.rows, { combatId: combat.id });
  const hostiles = shaped.filter((r) => r.hostile);
  const friends = shaped.filter((r) => !r.hostile);
  // The recipe's a and c: the first hostile and the first friendly row, by id.
  const rowOf = (k) => ({ a: hostiles, c: friends }[k] ?? []).map((r) => r).sort((p, q) => (p.id < q.id ? -1 : 1))[0];
  const order = (list) => [...list].sort((p, q) => Number(q.hostile) - Number(p.hostile) || (p.id < q.id ? -1 : 1)).map((r) => r.id);
  const expected = order(shaped);
  check("setup: four rows on four tokens, two hostile, all at initiative 4", shaped.length === 4 && hostiles.length === 2 && new Set(shaped.map((r) => r.tokenId)).size === 4 && shaped.every((r) => r.initiative === 4 && !r.outnumbering), shaped.map((r) => ({ hostile: r.hostile, initiative: r.initiative })));
  if (shaped.length !== 4) throw new Error(`the kept combat holds ${shaped.length} rows, not four; it is read, never driven`);

  section("Tied initiative: 1. one order on both seats");
  const tg = await run(gm, P.turns, { combatId: combat.id, setup: true });
  const tp = await until(player, P.turns, { combatId: combat.id, setup: true }, (t) => t.visible && t.turns.length === 4);
  note("turns", { gm: tg.turns, player: tp.turns, expected });
  check("1: the GM seat and the Player seat read the same order, hostile first, then by id", same(tg.turns, expected) && same(tp.turns, expected), { gm: same(tg.turns, expected), player: same(tp.turns, expected) });
  check("1: setupTurns() returns that array on each seat with nothing thrown", !tg.threw && !tp.threw && same(tg.returned, expected) && same(tp.returned, expected), { gm: tg.threw, player: tp.threw, libWrapper: g.libWrapper });

  section("Tied initiative: 2. any arrival sequence");
  const rrows = await run(gm, P.rows, { combatId: reversed.id });
  const tr = await run(gm, P.turns, { combatId: reversed.id, setup: true });
  const tokenOrder = (turnIds, list) => turnIds.map((id) => list.find((r) => r.id === id)?.tokenId);
  // The tie goes to the lower COMBATANT id (compareTied), so a second combat orders its
  // own rows by their own ids: the order is independent of the sequence they arrived in.
  check("2: rows created in reverse sort hostile first, then by their own ids, as step 1's rule", same(tr.turns, order(rrows)) && rrows.length === 4, { same: same(tr.turns, order(rrows)) });
  note("2: the same tokens in the same order as step 1 (the recipe's wording)", same(tokenOrder(tr.turns, rrows), tokenOrder(expected, rows)));

  section("Tied initiative: 3. a seat on another sort algorithm");
  const other = await run(player, P.otherSort, { combatId: combat.id });
  check("3: an insertion sort on the Player page gives the GM seat's order", same(other, tg.turns), { same: same(other, tg.turns) });

  section("Tied initiative: 5. different initiative is the system's");
  await run(gm, P.setRows, { combatId: combat.id, rows: [{ _id: rowOf("c").id, initiative: 6 }, { _id: rowOf("a").id, initiative: 2 }] });
  const t5 = await until(gm, P.turns, { combatId: combat.id }, (t) => t.turns[0] === rowOf("c").id);
  const p5 = await until(player, P.turns, { combatId: combat.id }, (t) => t.turns[0] === rowOf("c").id);
  const rest = expected.filter((id) => id !== rowOf("c").id && id !== rowOf("a").id);
  check("5: c first, a last, the rest in the tied order, on both seats", same(t5.turns, [rowOf("c").id, ...rest, rowOf("a").id]) && same(p5.turns, t5.turns), { gm: t5.turns.length, same: same(p5.turns, t5.turns) });
  await run(gm, P.shapeCombat, { combatId: combat.id });

  section("Tied initiative: 6. End Turn follows it");
  const start6 = await until(gm, P.turns, { combatId: combat.id }, (t) => same(t.turns, expected) && t.turn === 0);
  check("6: the combat starts the step on turn 0 of the shared order", start6.turn === 0 && same(start6.turns, expected), { turn: start6.turn });
  const t6 = await run(gm, P.nextTurn, { combatId: combat.id });
  const p6 = await until(player, P.turns, { combatId: combat.id }, (t) => t.turn === 1);
  check("6: the turn goes from 0 to 1 and both seats name the second row of the shared order", t6.turn === 1 && t6.current === expected[1] && p6.turn === 1 && p6.current === expected[1], { gm: { turn: t6.turn, current: t6.current }, player: { turn: p6.turn, current: p6.current }, expected: expected[1], order: expected });
  await run(gm, P.shapeCombat, { combatId: combat.id });
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  try {
    if (gm && swept.length) {
      const sw = await gm.sweepTracked({ only: swept });
      note("sweep (gm)", { removed: sw.removed.map((e) => e.uuid), missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
    }
  } catch (err) { console.error("sweep gm:", err?.message ?? err); }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
