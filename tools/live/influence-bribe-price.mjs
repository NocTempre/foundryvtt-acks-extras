/**
 * Live walk, influence-bribe-price: what a bribe costs. Walks
 * docs/influence/TESTING.md step 8d on the GM and Player seats: the Revised
 * Rulebook's wage and influence tables read from the staged book on the GM
 * seat (the bribe select stays disabled until `influence.bribeTiers` is read), the bribe
 * fee the GM's page prices for a tier with its provenance tooltip, and, under
 * a walk-only registry layer on the GM seat that empties the pay periods, the
 * fee saying it is not priced and a Player seat's blind offer buying no bonus,
 * moving no coin and warning the GM. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `influence/bribe-influencer`, a
 * character the Player seat owns, topped up with coin at the step's start; and
 * `influence/bribe-target`, a character the Player seat cannot observe. The
 * cards the blind roll posts are tracked and swept. The walk-only layer sits
 * at a registry priority no import or override uses, on the GM seat only, and
 * is removed in teardown. Every figure printed is a boolean or a count; no
 * wage, fee or page read from the world leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";
import { walkDone } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const BOOK = books(["rr"])[0] ?? null;
/** Between the world's import layer and the Judge's override: nothing else registers here. */
const WALK_LAYER = 25;
const SOURCE = "walk:influence-bribe-price";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__ibBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__ib = globalThis.__ib ?? {});
    H.W = await import("/modules/acks-extras/scripts/henchmen/rules/wages.mjs");
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 80, every = 250 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => {
      const el = app?.element;
      return el?.nodeType === 1 ? el : (el?.[0] ?? null);
    };
    if (!H.notesPatched) {
      H.notes = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.notesPatched = true;
    }
    return {
      isGM: game.user.isGM, role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null,
      boot: globalThis.__ibBoot ?? null,
    };
  },
  /** Whether this seat's registry prices a bribe at all: booleans only. */
  priced: async () => {
    const W = globalThis.__ib.W;
    return { wage: W.henchmanWageImported(), periods: !!W.signingBonusCost(1, 120, false) };
  },
  userId: async ({ name }) => game.users.getName(name)?.id ?? null,
  shape: async ({ influencerId, targetId, playerId }) => {
    const OWN = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const influencer = game.actors.get(influencerId);
    const target = game.actors.get(targetId);
    await influencer.update({ [`ownership.${playerId}`]: OWN.OWNER });
    await target.update({ [`ownership.${playerId}`]: OWN.NONE, "ownership.default": OWN.NONE });
    const M = acksExtras.lib.money;
    if (M.purseGp(influencer) < 1000) await M.creditCoin(influencer, [{ cv: 100, count: 1000 }]);
    return {
      owned: influencer.ownership[playerId] === OWN.OWNER,
      unseen: !target.testUserPermission(game.users.get(playerId), "OBSERVER"),
      funded: M.purseGp(influencer) >= 1000,
    };
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__ib;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    const imp = await H.poll(() => (typeof acksExtras.importer?.connectBookUrl === "function" ? acksExtras.importer : null), { tries: 120, every: 500 });
    if (!imp) return { started: false, error: "no importer api on this seat after 60 s" };
    globalThis.__ibBook = { done: false };
    imp.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__ibBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__ibBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__ibBook, session: !!globalThis.__ib.CB.cookbookSessionDoc(id) }),
  importDoc: async ({ id }) => {
    globalThis.__ibImport = { done: false };
    acksExtras.importer.cookbookImportTables([id])
      .then((r) => { globalThis.__ibImport = { done: true, ok: true, imported: (r?.imported ?? []).map((d) => d.docId), missingBooks: r?.missingBooks ?? [] }; })
      .catch((e) => { globalThis.__ibImport = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importState: async () => ({ ...globalThis.__ibImport }),
  /** Whether the GM seat's registry holds the bribe tier rows: a boolean only. */
  tiersRead: async () => {
    const T = acksExtras.lib.tables;
    return { tiers: T.hasDoc("influence") && !!T.getDoc("influence").tables?.bribeTiers };
  },
  /**
   * The GM's page with the first bribe tier armed: the fee it fills and the
   * tooltip on it, against the price the imported tables give.
   */
  fee: async ({ influencerId, targetId }) => {
    const H = globalThis.__ib;
    const influencer = game.actors.get(influencerId);
    const target = game.actors.get(targetId);
    const app = await acksExtras.influence.open(influencer, { targetActor: target });
    const root = await H.poll(() => H.root(app)?.querySelector('[name="mod.bribe"]') ? H.root(app) : null);
    if (!root) { await app?.close?.(); return { opened: false }; }
    const select = root.querySelector('[name="mod.bribe"]');
    select.value = "1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const input = await H.poll(() => {
      const el = H.root(app)?.querySelector('[name="mod.bribeFee"]');
      return el && el.dataset.tooltipText ? el : null;
    }, { tries: 40 });
    const level = Math.floor(Number(acksExtras.lib.actorRead.hitDiceOrLevel(target)) || 0);
    const expected = H.W.henchmanWageImported() ? H.W.signingBonusCost(1, H.W.henchmanWage(level), false)?.gp ?? null : null;
    const value = Number(input?.value);
    const tip = input?.dataset.tooltipText ?? "";
    const missing = game.i18n.localize("ACKS-INFLUENCE.bribe.feeTipMissing");
    const out = {
      opened: true,
      tipped: !!input,
      priced: expected != null,
      feeIsPrice: expected != null && value === expected,
      feePositive: value > 0,
      tipNamesFee: expected != null && tip.includes(`${expected} gp`),
      tipSaysMissing: tip === missing,
      feeZero: value === 0,
      noRawKey: !/ACKS-/.test(tip),
    };
    await app.close();
    return out;
  },
  layer: async ({ on, priority, source }) => {
    const T = acksExtras.lib.tables;
    if (!on) return { removed: T.unregisterTable("wages", { priority }) };
    if (T.getLayer("wages", priority)) return { placed: false, reason: "the priority is in use" };
    T.registerTable({ id: "wages", tables: { signingBonus: { proficient: {}, nonProficient: {} } } }, { priority, source });
    return { placed: true, now: !globalThis.__ib.W.signingBonusCost(1, 120, false) };
  },
  /** Clear this seat's recorded notices. */
  clearNotes: async () => { globalThis.__ib.notes.length = 0; return true; },
  notes: async ({ key }) => {
    const want = game.i18n.localize(key);
    return { said: globalThis.__ib.notes.some((n) => n.kind === "warn" && n.text === want), count: globalThis.__ib.notes.length };
  },
  /** The Player seat's blind offer on a target it cannot see, pressed through its own page. */
  blind: async ({ influencerId, targetId, offer }) => {
    const H = globalThis.__ib;
    const influencer = game.actors.get(influencerId);
    const target = game.actors.get(targetId) ?? null;
    const before = acksExtras.lib.money.purseGp(influencer);
    const app = await acksExtras.influence.open(influencer, { targetActor: target });
    const root = await H.poll(() => H.root(app)?.querySelector('[name="mod.bribeFee"]') ? H.root(app) : null);
    if (!root) { await app?.close?.(); return { opened: false }; }
    const masked = !root.querySelector('[name="mod.bribe"]');
    const fee = root.querySelector('[name="mod.bribeFee"]');
    fee.value = String(offer);
    fee.dispatchEvent(new Event("change", { bubbles: true }));
    await H.sleep(300);
    const roll = H.root(app)?.querySelector('[data-action="roll"]');
    roll?.click();
    await H.sleep(2500);
    try { await app.close(); } catch {}
    return { opened: true, masked, pressed: !!roll, before };
  },
  /** The GM seat's view after a blind roll: the newest card the influencer spoke, and both purses. */
  after: async ({ influencerId, targetId, since }) => {
    const H = globalThis.__ib;
    const influencer = game.actors.get(influencerId);
    const target = game.actors.get(targetId);
    const card = await H.poll(() => game.messages.contents.filter((m) => m.timestamp >= since && m.speaker?.actor === influencerId).at(-1) ?? null, { tries: 40 });
    const html = card?.content ?? "";
    return {
      cardId: card?.id ?? null,
      bribeLine: /influence-chat-bribe/.test(html),
      influencerGp: acksExtras.lib.money.purseGp(influencer),
      targetGp: acksExtras.lib.money.purseGp(target),
    };
  },
  now: async () => Date.now(),
  purse: async ({ id }) => acksExtras.lib.money.purseGp(game.actors.get(id)),
  restore: async ({ priority, source }) => {
    const H = globalThis.__ib;
    if (!H) return { notes: "never installed" };
    const T = acksExtras.lib.tables;
    const layer = T.getLayer("wages", priority)?._registeredBy === source ? T.unregisterTable("wages", { priority }) : false;
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; }
    return { notes: "restored", layerRemoved: layer };
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.tables`); } catch { ok = false; }
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
/** The uuids of the cards this run's rolls posted: the only documents teardown deletes. */
const cards = [];
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
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    const phases = c.boot?.phases ?? [];
    check(`${key}: init, setup and ready ran with no error recorded from before the first script`, ["init", "setup", "ready"].every((p) => phases.includes(p)) && (c.boot?.errors ?? []).length === 0, { phases, errors: (c.boot?.errors ?? []).length });
  }

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: SEATS.player });
  const influencer = await gm.fixture("influence/bribe-influencer", "Actor", { name: "QA Bribe Influencer", type: "character" });
  const target = await gm.fixture("influence/bribe-target", "Actor", { name: "QA Bribe Target", type: "character" });
  const shaped = await run(gm, P.shape, { influencerId: influencer.id, targetId: target.id, playerId });
  check("8d: the Player seat owns the funded influencer and cannot observe the target", shaped.owned && shaped.unseen && shaped.funded, shaped);

  section("8d: the wage tables read from the book (the real trigger)");
  note("priced before", await run(gm, P.priced));
  if (!BOOK) throw new Error("ACKS_TEST_BOOKS names no rr book");
  note("book", await run(gm, P.connectBook, BOOK));
  let bookState = null;
  for (let n = 0; n < 150; n++) { bookState = await run(gm, P.bookState, { id: BOOK.id }); if (bookState.done || bookState.session) break; await sleep(2000); }
  check("8d: the staged rulebook opens on the GM seat", !!bookState?.session, { session: !!bookState?.session, ok: bookState?.ok ?? null });
  await run(gm, P.importDoc, { id: "wages" });
  let imported = null;
  for (let n = 0; n < 120; n++) { imported = await run(gm, P.importState); if (imported.done) break; await sleep(2000); }
  check("8d: Rules tables for the wages document runs and names no missing book", imported?.ok && imported.imported.includes("wages") && !imported.missingBooks.length, imported);
  const priced = await run(gm, P.priced);
  check("8d: the GM seat now holds the wage ladder and the pay periods", priced.wage && priced.periods, priced);
  await run(gm, P.importDoc, { id: "influence" });
  let influenceImport = null;
  for (let n = 0; n < 120; n++) { influenceImport = await run(gm, P.importState); if (influenceImport.done) break; await sleep(2000); }
  // Only the Revised Rulebook is staged here; a table of the document that another book prints is reported missing, and the bribe tiers are the Rulebook's.
  check("8d: Rules tables for the influence document runs and imports it", influenceImport?.ok && influenceImport.imported.includes("influence"), { ok: influenceImport?.ok, imported: influenceImport?.imported, missingBooks: (influenceImport?.missingBooks ?? []).length });
  check("8d: the GM seat holds influence.bribeTiers, which the bribe select needs", (await run(gm, P.tiersRead)).tiers, null);

  section("8d: the GM's page prices the bribe and says where the figure came from");
  const fee = await run(gm, P.fee, { influencerId: influencer.id, targetId: target.id });
  check("8d: the first tier's fee is the imported period of the imported wage, above nothing", fee.opened && fee.priced && fee.feeIsPrice && fee.feePositive, fee);
  check("8d: the fee's tooltip names the figure, with no raw key", fee.tipped && fee.tipNamesFee && fee.noRawKey, fee);

  section("8d: the pay periods missing on the GM seat (walk-only layer)");
  const layered = await run(gm, P.layer, { on: true, priority: WALK_LAYER, source: SOURCE });
  check("8d: the walk's layer stands and the GM seat prices nothing", layered.placed && layered.now, layered);
  const unpriced = await run(gm, P.fee, { influencerId: influencer.id, targetId: target.id });
  check("8d: the fee is 0 and its tooltip says it is not priced", unpriced.opened && unpriced.feeZero && unpriced.tipSaysMissing && unpriced.noRawKey, unpriced);
  await run(gm, P.clearNotes);
  const since = await run(gm, P.now);
  const offered = await run(player, P.blind, { influencerId: influencer.id, targetId: target.id, offer: 50 });
  check("8d: the Player seat's page masks the tier and takes a blind offer", offered.opened && offered.masked && offered.pressed, offered);
  const after = await run(gm, P.after, { influencerId: influencer.id, targetId: target.id, since });
  if (after.cardId) { await gm.track(after.cardId, "ChatMessage"); cards.push(`ChatMessage.${after.cardId}`); }
  check("8d: the blind roll is resolved at the GM seat, and its card states no bribe", !!after.cardId && !after.bribeLine, { card: !!after.cardId, bribeLine: after.bribeLine });
  check("8d: no coin left the influencer", after.influencerGp === offered.before, { unchanged: after.influencerGp === offered.before });
  check("8d: the GM seat is told the offer had no price to meet", (await run(gm, P.notes, { key: "ACKS-INFLUENCE.bribe.unpriced" })).said, null);
  note("layer removed", await run(gm, P.layer, { on: false, priority: WALK_LAYER }));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore, { priority: WALK_LAYER, source: SOURCE })); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the cards go.
  try { if (gm && cards.length) note("swept", await gm.sweepTracked({ only: cards })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: influence/bribe-influencer, influence/bribe-target");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
