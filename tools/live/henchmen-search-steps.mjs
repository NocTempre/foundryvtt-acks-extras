/**
 * Live walk, henchmen-search-steps: a directed search's rarity steps.
 * Walks docs/henchmen/TESTING.md step 18 on the GM and Player seats: the
 * Judges Journal's rules tables read again from the staged book on the GM seat,
 * the steps the world then holds, the posting dialog's level and commission
 * hints naming them on both seats, a commissioned search posted through the
 * dialog and its monthly renewal rolling as a commission, and, under a
 * walk-only registry layer that lacks the commission step, the dialog saying
 * so and a commissioned search refused with its message. Machine values arrive
 * through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `henchmen/search-steps-place`, a location
 * with a market the Player seat observes, and `henchmen/search-steps-employer`,
 * a character the Player seat owns. The step's start empties the place's
 * candidates, postings and classes never offered. Nothing is swept; the posting
 * the walk writes lives on the place's own market. The walk-only layer sits at
 * a registry priority no import or override uses, on the GM seat only, and is
 * removed in teardown. Every figure printed is a count or a boolean; no step,
 * class or expression read from the world leaves the page.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm, player: MACHINE.player };
const BOOK = books(["jj"])[0] ?? null;
/** Between the world's import layer and the Judge's override: nothing else registers here. */
const WALK_LAYER = 25;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__ssBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__ss = globalThis.__ss ?? {});
    H.AV = await import("/modules/acks-extras/scripts/henchmen/rules/availability.mjs");
    H.RC = await import("/modules/acks-extras/scripts/henchmen/engine/recruitment.mjs");
    H.LD = await import("/modules/acks-extras/scripts/location/data/location-data.mjs");
    H.PD = await import("/modules/acks-extras/scripts/henchmen/apps/posting-dialog.mjs");
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
      offerable: H.AV.offerableClasses().length,
      boot: globalThis.__ssBoot ?? null,
    };
  },
  market: async () => globalThis.__ss.LD.emptyMarket(),
  userId: async ({ name }) => game.users.getName(name)?.id ?? null,
  shape: async ({ placeId, employerId, playerId }) => {
    const OWN = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const place = game.actors.get(placeId);
    const employer = game.actors.get(employerId);
    await place.update({
      "system.market.blockedClasses": [],
      "system.market.candidates": [],
      "system.market.postings": [],
      "system.market.classRarityTableId": "default",
      [`ownership.${playerId}`]: OWN.OBSERVER,
    });
    await employer.update({ [`ownership.${playerId}`]: OWN.OWNER });
    return {
      market: !!place.system.hasMarket,
      postings: (place.system.market.postings ?? []).length,
      placeSeen: place.ownership[playerId] === OWN.OBSERVER,
      employerOwned: employer.ownership[playerId] === OWN.OWNER,
    };
  },
  /** Which steps this seat's registry holds: booleans only. */
  steps: async () => {
    const s = globalThis.__ss.AV.searchSteps();
    return { perLevel: Number.isInteger(s.perLevel), perRank: Number.isInteger(s.perRank), eased: Number.isInteger(s.eased), easedPositive: s.eased > 0 };
  },
  waitSteps: async () => {
    const H = globalThis.__ss;
    const ok = await H.poll(() => Number.isInteger(H.AV.searchSteps().eased), { tries: 60, every: 500 });
    return !!ok;
  },
  connectBook: async ({ id, path }) => {
    const H = globalThis.__ss;
    if (H.CB.cookbookSessionDoc(id)) return { already: true };
    const imp = await H.poll(() => (typeof acksExtras.importer?.connectBookUrl === "function" ? acksExtras.importer : null), { tries: 120, every: 500 });
    if (!imp) return { started: false, error: "no importer api on this seat after 60 s" };
    globalThis.__ssBook = { done: false };
    imp.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__ssBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__ssBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__ssBook, session: !!globalThis.__ss.CB.cookbookSessionDoc(id) }),
  importDoc: async ({ id }) => {
    globalThis.__ssImport = { done: false };
    acksExtras.importer.cookbookImportTables([id])
      .then((r) => { globalThis.__ssImport = { done: true, ok: true, imported: (r?.imported ?? []).map((d) => d.docId), missingBooks: r?.missingBooks ?? [] }; })
      .catch((e) => { globalThis.__ssImport = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  importState: async () => ({ ...globalThis.__ssImport }),
  /**
   * A class whose rarity the commission step moves: the first offerable class
   * whose tier lies at least that many steps from the common end.
   */
  pick: async () => {
    const H = globalThis.__ss;
    const { eased } = H.AV.searchSteps();
    for (const c of H.AV.offerableClasses()) {
      const tier = H.AV.classRarity(c, "default");
      if (tier && H.AV.shiftRarity(tier, -eased) !== tier) { H.cls = c; return { found: true }; }
    }
    return { found: false };
  },
  /** The served pool roll for the picked class, plain and commissioned, with a die that always answers 1. */
  pools: async ({ placeId, employerId }) => {
    const H = globalThis.__ss;
    const place = game.actors.get(placeId);
    const mc = H.RC.effectiveMarketClass(place, game.actors.get(employerId), { network: false });
    const one = async () => 1;
    const plain = await H.AV.rollMonthlyPool({ kind: "henchmanByClass", classKey: H.cls }, mc, one, () => 0);
    const comm = await H.AV.rollMonthlyPool({ kind: "henchmanByClass", classKey: H.cls, commissioned: true }, mc, one, () => 0);
    H.commExpr = H.AV.rarityExpr(comm.rarity, mc);
    H.plainExpr = H.AV.rarityExpr(plain.rarity, mc);
    return {
      noError: !plain.error && !comm.error,
      eased: comm.rarity === H.AV.shiftRarity(plain.rarity, -H.AV.searchSteps().eased) && comm.rarity !== plain.rarity,
      exprsDiffer: !!H.commExpr && H.commExpr !== H.plainExpr,
    };
  },
  /** The posting dialog's two hints, as this seat renders them, against the strings the imported steps make. */
  hints: async ({ placeId }) => {
    const H = globalThis.__ss;
    const place = game.actors.get(placeId);
    const before = new Set(foundry.applications.instances.keys());
    H.PD.openPostingDialog(place);
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.has(a.id) && a.rendered && H.root(a)?.querySelector("[name='commissioned']")), { tries: 40 });
    if (!app) return { opened: false };
    const root = H.root(app);
    const steps = H.AV.searchSteps();
    const want = (step, key, missing) => (step == null ? game.i18n.localize(missing) : game.i18n.format(key, { steps: step }));
    const level = root.querySelector("p.hint[data-kind-field='henchmanByClass']")?.textContent.trim() ?? null;
    const label = root.querySelector("[name='commissioned']")?.closest(".form-group")?.querySelector("label");
    const tip = label?.dataset.tooltipText ?? null;
    const out = {
      opened: true,
      level: level === want(steps.perLevel, "ACKS-HENCHMEN.posting.classLevelHint", "ACKS-HENCHMEN.posting.classLevelHintMissing"),
      levelImported: steps.perLevel != null,
      commission: tip === want(steps.eased, "ACKS-HENCHMEN.posting.commissionedHint", "ACKS-HENCHMEN.posting.commissionedHintMissing"),
      commissionImported: steps.eased != null,
      noRawKey: !/ACKS-HENCHMEN\./.test(`${level} ${tip}`),
    };
    await app.close({ animate: false });
    return out;
  },
  cls: async () => globalThis.__ss.cls,
  /**
   * A commissioned search for the class, filled and submitted in this seat's
   * dialog. On the Player seat it goes to the GM over the relay, and what the
   * GM wrote reaches this seat a moment later.
   */
  submit: async ({ placeId, employerId, cls }) => {
    const H = globalThis.__ss;
    if (cls) H.cls = cls;
    const place = game.actors.get(placeId);
    const before = new Set(foundry.applications.instances.keys());
    const postings = (place.system.market.postings ?? []).length;
    H.notes.length = 0;
    H.PD.openPostingDialog(place);
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.has(a.id) && a.rendered && H.root(a)?.querySelector("[name='commissioned']")), { tries: 40 });
    if (!app) return { opened: false };
    const form = H.root(app);
    const set = (name, value) => {
      const el = form.querySelector(`[name='${name}']`);
      if (!el) return false;
      if (el.type === "checkbox") el.checked = !!value;
      else el.value = value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.type === "checkbox" ? el.checked === !!value : el.value === String(value);
    };
    const filled = set("employerId", employerId) && set("kind", "henchmanByClass") && set("classKey", H.cls) && set("level", "") && set("commissioned", true);
    await H.sleep(200);
    form.requestSubmit();
    await H.poll(() => H.notes.some((n) => n.kind === "error" || n.kind === "info"), { tries: 60 });
    // A relayed post is written by the GM; its arrival here lags the reply.
    await H.poll(() => (place.system.market.postings ?? []).length > postings || H.notes.some((n) => n.kind === "error"), { tries: 40 });
    await H.sleep(500);
    if (app.rendered) await app.close({ animate: false });
    const list = place.system.market.postings ?? [];
    const made = list.length === postings + 1 ? list.at(-1) : null;
    const missing = game.i18n.localize("ACKS-HENCHMEN.posting.error.tables-missing");
    return {
      opened: true, filled,
      written: !!made, commissioned: !!made?.commissioned, active: made?.status === "active",
      submittedSaid: H.notes.some((n) => n.kind === "info" && n.text === game.i18n.localize("ACKS-HENCHMEN.posting.submitted")),
      refusedMissing: H.notes.some((n) => n.kind === "error" && n.text === missing),
      errors: H.notes.filter((n) => n.kind === "error").length,
      rawKeyShown: H.notes.some((n) => /ACKS-HENCHMEN\./.test(n.text)),
      postingsUnchanged: list.length === postings,
    };
  },
  /** The employer's active posting made due, then the place processed as the month turns. */
  renew: async ({ placeId, employerId }) => {
    const H = globalThis.__ss;
    const place = game.actors.get(placeId);
    const uuid = game.actors.get(employerId).uuid;
    const id = (place.system.market.postings ?? []).find((p) => p.status === "active" && p.employerUuid === uuid)?.id ?? null;
    const postings = foundry.utils.deepClone(place.system.market.postings ?? []).map((p) => (p.id === id ? { ...p, monthStartTime: 0 } : p));
    await place.update({ "system.market.postings": postings });
    // What a commissioned and a plain roll of the stored spec would each say,
    // read from the served roll with the stored alignment shift in it.
    const stored = (place.system.market.postings ?? []).find((p) => p.id === id);
    const spec = { ...(stored?.spec?.toObject?.() ?? stored?.spec ?? {}) };
    const mc = H.RC.effectiveMarketClass(place, game.actors.get(employerId), { network: !!stored?.network });
    const one = async () => 1;
    const exprOf = async (s) => H.AV.rarityExpr((await H.AV.rollMonthlyPool(s, mc, one, () => 0)).rarity, mc);
    const commExpr = await exprOf({ ...spec, commissioned: true });
    const plainExpr = await exprOf({ ...spec, commissioned: false });
    await H.RC.processLocation(place, game.time.worldTime);
    const after = (place.system.market.postings ?? []).find((p) => p.id === id);
    return {
      found: !!after,
      renewed: (after?.monthStartTime ?? 0) > 0,
      differ: !!commExpr && commExpr !== plainExpr,
      commissionedRoll: !!commExpr && String(after?.rollDetail ?? "").startsWith(commExpr),
      plainRoll: !!plainExpr && String(after?.rollDetail ?? "").startsWith(plainExpr),
    };
  },
  /** The walk-only layer: the world's search modifiers less the commission step. */
  layer: async ({ on, priority }) => {
    const T = acksExtras.lib.tables;
    if (!on) return { removed: T.unregisterTable("rarity", { priority }) };
    if (T.getLayer("rarity", priority)) return { placed: false, reason: "the priority is in use" };
    const { commissionedShift, ...rest } = T.getTable("rarity", "specificQualificationMods");
    T.registerTable({ id: "rarity", tables: { specificQualificationMods: rest } }, { priority, source: "walk:henchmen-search-steps" });
    return { placed: true, had: commissionedShift !== undefined, now: globalThis.__ss.AV.searchSteps().eased === null };
  },
  restore: async ({ priority }) => {
    const H = globalThis.__ss;
    if (!H) return { notes: "never installed" };
    const T = acksExtras.lib.tables;
    const layer = T.getLayer("rarity", priority)?._registeredBy === "walk:henchmen-search-steps" ? T.unregisterTable("rarity", { priority }) : false;
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
  note("installed", { gm: { module: installed.module, offerable: installed.offerable }, player: { role: seated.role } });
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });
  if (!installed.activeGMIsSelf) throw new Error("another client is the active GM; the automation would run there");
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }
  check("the world holds the imported class tables, so there are classes to search for", installed.offerable > 0, { offerable: installed.offerable > 0 });
  if (!installed.offerable) throw new Error("no class table imported: there is no class to search for");

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: SEATS.player });
  const market = await run(gm, P.market);
  const place = await gm.fixture("henchmen/search-steps-place", "Actor", { name: "QA Search Steps Place", type: "acks-extras.location", system: { market } });
  const employer = await gm.fixture("henchmen/search-steps-employer", "Actor", { name: "QA Search Steps Employer", type: "character" });
  const shaped = await run(gm, P.shape, { placeId: place.id, employerId: employer.id, playerId });
  check("18: the place has a market with no postings, the Player seat observes it and owns the employer", shaped.market && shaped.postings === 0 && shaped.placeSeen && shaped.employerOwned, shaped);

  section("18: the rules tables read again from the book (the real trigger)");
  note("steps before", await run(gm, P.steps));
  if (!BOOK) throw new Error("ACKS_TEST_BOOKS names no jj copy: the rules tables cannot be read again from the book");
  note("book", await run(gm, P.connectBook, BOOK));
  let bookState = null;
  for (let n = 0; n < 150; n++) { bookState = await run(gm, P.bookState, { id: BOOK.id }); if (bookState.done || bookState.session) break; await sleep(2000); }
  check("18: the staged book opens on the GM seat", !!bookState?.session, { session: !!bookState?.session, ok: bookState?.ok ?? null });
  await run(gm, P.importDoc, { id: "rarity" });
  let imported = null;
  for (let n = 0; n < 120; n++) { imported = await run(gm, P.importState); if (imported.done) break; await sleep(2000); }
  check("18: Rules tables for the rarity document runs and names no missing book", imported?.ok && imported.imported.includes("rarity") && !imported.missingBooks.length, imported);
  const gmSteps = await run(gm, P.steps);
  check("18: the GM seat now holds all three steps, the commission step a positive figure", gmSteps.perLevel && gmSteps.perRank && gmSteps.eased && gmSteps.easedPositive, gmSteps);
  check("18: the Player seat sees the commission step arrive", await run(player, P.waitSteps), null);

  section("18: the dialog names the steps in force");
  const gmHints = await run(gm, P.hints, { placeId: place.id });
  const playerHints = await run(player, P.hints, { placeId: place.id });
  note("hints", { gm: gmHints, player: playerHints });
  for (const [seat, h] of [["GM", gmHints], ["Player", playerHints]]) {
    check(`18: the ${seat} seat's level hint and commission tooltip are the imported strings, with no raw key`, h.opened && h.level && h.levelImported && h.commission && h.commissionImported && h.noRawKey, h);
  }

  section("18: the served pool roll");
  const picked = await run(gm, P.pick);
  check("18: an offerable class lies far enough from the common end for the commission to move it", picked.found, picked);
  if (!picked.found) throw new Error("no offerable class the commission step can move");
  const pools = await run(gm, P.pools, { placeId: place.id, employerId: employer.id });
  check("18: the served pool roll eases the commissioned search by the imported step", pools.noError && pools.eased && pools.exprsDiffer, pools);
  const cls = await run(gm, P.cls);

  section("18: the commission step missing on the GM seat (walk-only layer)");
  const layered = await run(gm, P.layer, { on: true, priority: WALK_LAYER });
  check("18: the walk's layer stands and the GM seat reads no commission step", layered.placed && layered.now, layered);
  const missingHints = await run(gm, P.hints, { placeId: place.id });
  check("18: the GM's commission tooltip says the step is not imported, and the level hint still names its step", missingHints.opened && missingHints.commission && !missingHints.commissionImported && missingHints.level && missingHints.levelImported && missingHints.noRawKey, missingHints);
  const refused = await run(player, P.submit, { placeId: place.id, employerId: employer.id, cls });
  check("18: the Player's commissioned search comes back refused with the tables-missing message, no raw key, no posting", refused.opened && refused.filled && refused.refusedMissing && !refused.submittedSaid && !refused.rawKeyShown && refused.postingsUnchanged, refused);
  note("layer removed", await run(gm, P.layer, { on: false, priority: WALK_LAYER }));
  const back = await run(gm, P.hints, { placeId: place.id });
  check("18: with the layer gone the GM's dialog names the imported step again", back.opened && back.commission && back.commissionImported, back);

  section("18: a commissioned search from the Player seat, and its renewal");
  const posted = await run(player, P.submit, { placeId: place.id, employerId: employer.id, cls });
  check("18: submitted through the Player's dialog, the search is written active and commissioned, and says submitted", posted.opened && posted.filled && posted.written && posted.commissioned && posted.active && posted.submittedSaid && !posted.errors, posted);
  const renewed = await run(gm, P.renew, { placeId: place.id, employerId: employer.id });
  check("18: the month turns and the posting renews rolling as a commission", renewed.found && renewed.differ && renewed.renewed && renewed.commissionedRoll && !renewed.plainRoll, renewed);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore, { priority: WALK_LAYER })); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log("fixtures kept: henchmen/search-steps-place, henchmen/search-steps-employer");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
