/**
 * Live walk, henchmen-blocked-classes: a market's classes never offered.
 * Walks docs/henchmen/TESTING.md step 17 on the GM and Player seats: the
 * place sheet's GM Settings block (add a row, pick the class, read it back),
 * a class draw that rolls again on a blocked class, a GM placement whose rolled
 * class lands on the special row once every draw is blocked, that candidate
 * hired with no class bound and its Service tab offering the Judge Pick class
 * (the class picker opening on it) and the Player seat none, a player's
 * directed search refused, and the posting dialog listing the class disabled
 * with its reason. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: `henchmen/blocked-classes-place`, a
 * location with a market the Player seat observes, and
 * `henchmen/blocked-classes-employer`, a character the Player seat owns. Each
 * step that needs a shape writes it at its start: the place's blocked list,
 * candidates and postings emptied, the employer's henchmen list emptied. The
 * hireling the hire makes and the cards it posts are tracked by uuid and
 * swept; the candidates and the placement posting the walk writes live on
 * the place's own market. The world
 * must hold the imported class tables: the walk reads which class a die of 1
 * draws and prints only whether it found one. Every figure printed is a count
 * or a boolean; no class name leaves the page.
 */
import path from "node:path";
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, logDir, shotDir } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

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
const plate = (name) => path.join(process.env.SHOTS === "1" ? shotDir() : logDir(), name).replaceAll("\\", "/");

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__bcBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__bc = globalThis.__bc ?? {});
    H.AV = await import("/modules/acks-extras/scripts/henchmen/rules/availability.mjs");
    H.CD = await import("/modules/acks-extras/scripts/henchmen/rules/candidates.mjs");
    H.RC = await import("/modules/acks-extras/scripts/henchmen/engine/recruitment.mjs");
    H.LD = await import("/modules/acks-extras/scripts/location/data/location-data.mjs");
    H.PD = await import("/modules/acks-extras/scripts/henchmen/apps/posting-dialog.mjs");
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
      user: game.user.name, isGM: game.user.isGM, role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      module: game.modules.get("acks-extras")?.version ?? null,
      offerable: H.AV.offerableClasses().length,
      boot: globalThis.__bcBoot ?? null,
    };
  },
  market: async () => globalThis.__bc.LD.emptyMarket(),
  userId: async ({ name }) => game.users.getName(name)?.id ?? null,
  /** The place and employer brought to the shape every step starts from. */
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
    await employer.update({ [`ownership.${playerId}`]: OWN.OWNER, "system.henchmenList": [] });
    return {
      market: !!place.system.hasMarket,
      blocked: place.system.market.blockedClasses.length,
      candidates: (place.system.candidates ?? []).length,
      placeSeen: place.ownership[playerId] === OWN.OBSERVER,
      employerOwned: employer.ownership[playerId] === OWN.OWNER,
    };
  },
  /** The class a die of 1 draws here, and a row in the same bucket that draws another. */
  target: async () => {
    const H = globalThis.__bc;
    const tables = acksExtras.lib.tables;
    const distribution = H.CD && tables.hasDoc("rarity") ? (() => { try { return tables.getTable("rarity", "classDistribution"); } catch { return null; } })() : null;
    if (!distribution?.buckets?.length) return { found: false };
    const bucket = tables.bracketRow(distribution.buckets, 1);
    const first = tables.bracketRow(bucket?.rows ?? [], 1);
    const other = (bucket?.rows ?? []).find((r) => r.class && r.class !== first?.class && r.class !== "special");
    H.x0 = first?.class ?? null;
    H.y = other?.class ?? null;
    H.yRow = other?.min ?? null;
    return { found: !!H.x0 && H.x0 !== "special" && !!H.y, offerable: H.AV.offerableClasses().includes(H.x0) };
  },
  /** The place sheet on GM Settings, the add button pressed, the row's class picked as a user picks it. */
  sheet: async ({ placeId }) => {
    const H = globalThis.__bc;
    const place = game.actors.get(placeId);
    const app = place.sheet;
    await app.render(true);
    await H.poll(() => app.rendered && H.root(app)?.querySelector("[data-tab='gmSettings']"));
    app.changeTab("gmSettings", "primary");
    await H.sleep(300);
    let block = H.root(app).querySelector(".acks-extras-blocked-classes");
    const before = {
      block: !!block,
      add: !!block?.querySelector("button[data-action='addBlockedClass']"),
      addNamed: !!block?.querySelector("button[data-action='addBlockedClass']")?.getAttribute("aria-label"),
      hint: (block?.querySelector(".hint")?.textContent ?? "").trim() === game.i18n.localize("ACKS-HENCHMEN.location.blockedClassesEmpty"),
    };
    block.querySelector("button[data-action='addBlockedClass']").click();
    await H.poll(() => place.system.market.blockedClasses.length === 1 && H.root(app)?.querySelector(".acks-extras-blocked-classes select"));
    await H.sleep(300);
    block = H.root(app).querySelector(".acks-extras-blocked-classes");
    const select = block.querySelector("select[name='system.market.blockedClasses.0']");
    const options = [...(select?.options ?? [])].map((o) => o.value);
    select.value = H.x0;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await H.poll(() => place.system.market.blockedClasses[0] === H.x0);
    await H.sleep(400);
    block = H.root(app).querySelector(".acks-extras-blocked-classes");
    block.scrollIntoView({ block: "center" });
    await H.sleep(300);
    return {
      ...before,
      rows: block.querySelectorAll("[data-blocked-index]").length,
      options: options.length,
      optionsAreOfferable: JSON.stringify([...options].sort()) === JSON.stringify([...H.AV.offerableClasses()].sort()),
      stored: place.system.market.blockedClasses.length === 1 && place.system.market.blockedClasses[0] === H.x0,
      shown: block.querySelector("select")?.value === H.x0,
      named: !!block.querySelector("select")?.getAttribute("aria-label") && !!block.querySelector("button[data-action='removeBlockedClass']")?.getAttribute("aria-label"),
      app: app.id,
    };
  },
  /** The draw itself, with a die that answers the blocked class's numbers first and another row's second. */
  reroll: async () => {
    const H = globalThis.__bc;
    const answers = [1, 1, 1, H.yRow];
    const calls = [];
    const roll = async (f) => { calls.push(f); return answers[Math.min(calls.length - 1, answers.length - 1)]; };
    const drawn = await H.CD.rollClassFromDistribution(roll, "default", 1, { blocked: [H.x0] });
    const plain = await H.CD.rollClassFromDistribution(async () => 1, "default", 1);
    return { rerolled: drawn.classKey === H.y && calls.length === 4, plain: plain.classKey === H.x0 };
  },
  /** A GM placement with no class named, every die a 1; the class the new candidate carries. */
  place: async ({ placeId }) => {
    const H = globalThis.__bc;
    const place = game.actors.get(placeId);
    const saved = CONFIG.Dice.randomUniform;
    let r;
    try {
      CONFIG.Dice.randomUniform = () => 0.975;
      r = await H.RC.createPosting(place, { kind: "henchmanByClass", classKey: "", level: 1 }, null);
    } finally {
      CONFIG.Dice.randomUniform = saved;
    }
    const last = (place.system.candidates ?? []).at(-1);
    return { placed: !!r?.gmPlaced, error: r?.error ?? null, isX0: last?.classKey === H.x0, special: last?.classKey === "special" };
  },
  /**
   * Hire the candidate the capped placement left on the special row, through
   * the module's hire, and read what it wrote. The ids of the actor and of
   * every card this seat posted meanwhile come back for the ledger.
   */
  hireSpecial: async ({ placeId, employerId }) => {
    const H = globalThis.__bc;
    const place = game.actors.get(placeId);
    const employer = game.actors.get(employerId);
    const candidate = (place.system.candidates ?? []).findLast((c) => c.classKey === H.CD.JUDGE_PICK_CLASS && c.status === "available");
    if (!candidate) return { found: false };
    const cards = [];
    const hook = Hooks.on("createChatMessage", (m, _o, userId) => { if (userId === game.user.id) cards.push(m.uuid); });
    let res;
    try {
      res = await acksExtras.henchmen.hire(place, candidate.id, employer, {});
      await H.sleep(800);
    } finally {
      Hooks.off("createChatMessage", hook);
    }
    const a = res?.actor ?? null;
    const rolled = a?.getFlag("acks-extras", "record")?.rolled ?? {};
    return {
      found: true,
      error: res?.error ?? null,
      uuid: a?.uuid ?? null,
      id: a?.id ?? null,
      cards,
      detailsClass: a?.system?.details?.class ?? null,
      rolledJudgePick: rolled.classKey === H.CD.JUDGE_PICK_CLASS,
      hpUnrolled: rolled.hpUnrolled ?? "",
      hpRolled: rolled.hpRoll != null,
    };
  },
  /** The hireling's Service tab as this seat sees it: the class row, its Pick class button, the hit point row; `press` clicks the button. */
  service: async ({ actorId, press = false }) => {
    const H = globalThis.__bc;
    const a = game.actors.get(actorId);
    const L = (k) => game.i18n.localize(`ACKS-HENCHMEN.service.${k}`);
    await a.sheet.render(true);
    await H.poll(() => H.root(a.sheet)?.isConnected);
    try { a.sheet.changeTab("service", "primary"); } catch { /* a sheet with no Service tab */ }
    await H.sleep(600);
    const service = H.root(a.sheet)?.querySelector(".acks-extras-service");
    const text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const rowNamed = (label) => [...(service?.querySelectorAll(".acks-extras-frame__row") ?? [])].find((r) => text(r.querySelector(".acks-extras-frame__row-label")) === L(label));
    const classRow = rowNamed("classLevel");
    const hpRow = rowNamed("hitPoints");
    const button = classRow?.querySelector("[data-pick-class]") ?? null;
    const hpValue = hpRow?.querySelector(".acks-extras-frame__row-value");
    const out = {
      rendered: !!service,
      classSaysPick: text(classRow?.querySelector(".acks-extras-frame__row-value")).startsWith(L("judgePick")),
      classRaw: text(classRow).includes(H.CD.JUDGE_PICK_CLASS),
      button: !!button,
      buttonNamed: !!button?.getAttribute("aria-label"),
      hpSaysNotRolled: text(hpValue) === L("hpJudgePick"),
      hpTipIsPick: hpValue?.dataset.tooltipText === L("tip.hpJudgePick"),
      rawKey: /ACKS-HENCHMEN\./.test(text(service)),
      picker: false,
    };
    if (press && button) {
      button.click();
      const picker = await H.poll(() => foundry.applications.instances.get(`acks-classes-assign-${a.id}`)?.rendered || null, { tries: 40, every: 250 });
      out.picker = !!picker;
      await foundry.applications.instances.get(`acks-classes-assign-${a.id}`)?.close();
    }
    await a.sheet.close();
    return out;
  },
  block: async ({ placeId, on }) => {
    const H = globalThis.__bc;
    const place = game.actors.get(placeId);
    await place.update({ "system.market.blockedClasses": on ? [H.x0] : [] });
    return place.system.market.blockedClasses.length;
  },
  /** A player's directed search for the blocked class, as the socket relay hands it to the GM. */
  refuse: async ({ placeId, employerId, playerId }) => {
    const H = globalThis.__bc;
    const place = game.actors.get(placeId);
    const before = (place.system.postings ?? []).length;
    const r = await H.RC.createPosting(place, { kind: "henchmanByClass", classKey: H.x0 }, game.actors.get(employerId), { requestUserId: playerId });
    await H.sleep(300);
    return { error: r?.error ?? null, postings: (place.system.postings ?? []).length === before };
  },
  /** The posting dialog's class list, as this seat sees it. */
  dialog: async ({ placeId, x0 }) => {
    const H = globalThis.__bc;
    const wanted = x0 ?? H.x0;
    const place = game.actors.get(placeId);
    const before = new Set(foundry.applications.instances.keys());
    H.PD.openPostingDialog(place);
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.has(a.id) && a.rendered && H.root(a)?.querySelector("select[name='classKey']")), { tries: 40 });
    if (!app) return { opened: false };
    const option = [...H.root(app).querySelectorAll("select[name='classKey'] option")].find((o) => o.value === wanted);
    const suffix = game.i18n.format("ACKS-HENCHMEN.posting.classBlocked", { class: "" }).trim();
    const out = { opened: true, listed: !!option, disabled: !!option?.disabled, says: !!option && option.textContent.includes(suffix) };
    await app.close({ animate: false });
    return out;
  },
  x0: async () => globalThis.__bc.x0,
  closeSheet: async ({ placeId }) => {
    const app = game.actors.get(placeId)?.sheet;
    if (app?.rendered) await app.close({ animate: false });
    return true;
  },
  restore: async () => {
    const H = globalThis.__bc;
    if (!H) return { notes: "never installed" };
    if (H.notesPatched) { for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k]; H.notesPatched = false; }
    return { notes: "restored" };
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
/** The uuids this run made and tracked: the hireling and the cards its hire posted. */
const own = [];
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
  if (!installed.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  for (const [key, c] of Object.entries({ gm: installed, player: seated })) {
    check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  }
  check("the world holds the imported class tables, so there are classes to offer", installed.offerable > 0, { offerable: installed.offerable > 0 });
  if (!installed.offerable) throw new Error("no class table imported: the class draws this walk exercises have nothing to draw");

  section("fixtures");
  const playerId = await run(gm, P.userId, { name: SEATS.player });
  const market = await run(gm, P.market);
  const place = await gm.fixture("henchmen/blocked-classes-place", "Actor", { name: "QA Blocked Classes Place", type: "acks-extras.location", system: { market } });
  const employer = await gm.fixture("henchmen/blocked-classes-employer", "Actor", { name: "QA Blocked Classes Employer", type: "character" });
  const shaped = await run(gm, P.shape, { placeId: place.id, employerId: employer.id, playerId });
  note("shape", shaped);
  check("17: the place has a market and an empty list, the Player seat observes it and owns the employer", shaped.market && shaped.blocked === 0 && shaped.candidates === 0 && shaped.placeSeen && shaped.employerOwned, shaped);
  const target = await run(gm, P.target);
  check("17: a die of 1 draws a class the place can offer, and the same bucket holds another", target.found && target.offerable, target);
  if (!target.found) throw new Error("the imported distribution gives no class for a die of 1 with another beside it");

  section("17: GM Settings, the block (plate)");
  await gm.compose();
  const sheet = await run(gm, P.sheet, { placeId: place.id });
  note("sheet", sheet);
  check("17: the block stands on GM Settings with its add button named, and says every class can be offered", sheet.block && sheet.add && sheet.addNamed && sheet.hint, sheet);
  check("17: Add makes one row whose select lists exactly the classes this place can offer", sheet.rows === 1 && sheet.optionsAreOfferable && sheet.options > 0, { rows: sheet.rows, options: sheet.options });
  check("17: the class picked in the row is the one stored and shown, and the controls are named", sheet.stored && sheet.shown && sheet.named, sheet);
  if (process.env.SHOTS === "1") note("plate", await gm.shot(plate("location-blocked-classes.png"), `#${sheet.app}`));
  await run(gm, P.closeSheet, { placeId: place.id });

  section("17: the class draw rolls again on a blocked class");
  const rr = await run(gm, P.reroll);
  check("17: the served draw takes the die's blocked class without the list, and draws again past it with the list", rr.plain && rr.rerolled, rr);

  section("17: a GM placement with every die a 1");
  await run(gm, P.block, { placeId: place.id, on: false });
  const control = await run(gm, P.place, { placeId: place.id });
  check("17: with nothing blocked, the placement rolls the die's class (the rig lands)", control.placed && control.isX0, control);
  await run(gm, P.block, { placeId: place.id, on: true });
  const capped = await run(gm, P.place, { placeId: place.id });
  check("17: with that class blocked, every draw lands on it, and the candidate's class is the special row", capped.placed && capped.special, capped);

  section("17: hiring the candidate whose class is the Judge's pick");
  const hired = await run(gm, P.hireSpecial, { placeId: place.id, employerId: employer.id });
  if (hired.uuid) { await gm.track(hired.uuid, "Actor"); own.push(hired.uuid); }
  for (const uuid of hired.cards ?? []) { await gm.track(uuid, "ChatMessage"); own.push(uuid); }
  check("17: the hire lands, binds no class, rolls no hit points, and records the class as the Judge's pick", hired.found && !hired.error && hired.detailsClass === "" && hired.rolledJudgePick && hired.hpUnrolled === "judgePick" && !hired.hpRolled,
    { found: hired.found, error: hired.error, classEmpty: hired.detailsClass === "", rolledJudgePick: hired.rolledJudgePick, hpUnrolled: hired.hpUnrolled, hpRolled: hired.hpRolled });
  if (hired.id) {
    const gmService = await run(gm, P.service, { actorId: hired.id, press: true });
    note("service (gm)", gmService);
    check("17: the Judge's Service tab says the class is the Judge's pick and offers a named Pick class; the hit points say not rolled and why",
      gmService.rendered && gmService.classSaysPick && !gmService.classRaw && gmService.button && gmService.buttonNamed && gmService.hpSaysNotRolled && gmService.hpTipIsPick && !gmService.rawKey, gmService);
    check("17: Pick class opens the class picker on the hireling", gmService.picker, { picker: gmService.picker });
    const playerService = await run(player, P.service, { actorId: hired.id });
    note("service (player)", playerService);
    check("17: the Player seat that owns the hireling reads the same row with no Pick class", playerService.rendered && playerService.classSaysPick && !playerService.button && playerService.hpSaysNotRolled, playerService);
  }

  section("17: a player's directed search for the blocked class");
  const refused = await run(gm, P.refuse, { placeId: place.id, employerId: employer.id, playerId });
  check("17: refused class-blocked, and no posting written", refused.error === "class-blocked" && refused.postings, refused);
  const gmList = await run(gm, P.dialog, { placeId: place.id });
  const x0 = await run(gm, P.x0);
  await run(player, P.install);
  const playerList = await run(player, P.dialog, { placeId: place.id, x0 });
  note("posting dialog", { gm: gmList, player: playerList });
  check("17: the GM's posting dialog lists the class disabled, saying it is never offered here", gmList.opened && gmList.listed && gmList.disabled && gmList.says, gmList);
  check("17: the Player seat's posting dialog lists it the same way", playerList.opened && playerList.listed && playerList.disabled && playerList.says, playerList);
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log("fixtures kept: henchmen/blocked-classes-place, henchmen/blocked-classes-employer");
  try { if (gm && own.length) note("sweep", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
