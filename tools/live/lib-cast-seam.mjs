/**
 * Live walk, lib-cast-seam: the one wrapper on the system's `Item#_useSpell`
 * (`scripts/lib/patches/spell-use.mjs`) and the claimants that ride it. Walks
 * docs/lib/TESTING.md "The cast seam claims a cast": a boot recorder attached
 * before the reload that sees `init`, `setup` and `ready`; the wrapper reaching
 * the class `CONFIG.Item.documentClass` names at `ready` through an embedded
 * spell, a world item and the world's first item; the Magic tab's cast button
 * with no claimant, with a declining one, a throwing `claims`, a claimant that
 * never spends, one that spends twice, one whose `cast` throws; a `spend`
 * called after `cast` has returned and one left unawaited; and the same cast
 * from a Player seat on a Player-owned copy. Prints booleans and counts, never
 * a spell's name. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `lib/cast-seam-caster` and `lib/cast-seam-caster-player`, characters with
 * spells enabled (the Player owns the second), each holding one spell
 * (`lib/cast-seam-spell`, `lib/cast-seam-spell-player`), and the world item
 * `lib/cast-seam-world-spell`. Each step resets `system.cast` to 0 before it
 * reads a count. The chat cards the walk makes speak as the two casters and are
 * swept by id; the walk's claimant is removed in a `finally` on both seats.
 */
import { connect, sleep, Cdp } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const CASTER = "lib/cast-seam-caster";
const SPELL = "lib/cast-seam-spell";
const CASTER_P = "lib/cast-seam-caster-player";
const SPELL_P = "lib/cast-seam-spell-player";
const WORLD = "lib/cast-seam-world-spell";
const KEY = "lib-cast-seam-walk";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Runs before any of Foundry's scripts on the next document load: records warnings and errors from `init` on. */
const BOOT_RECORDER = `(() => {
  if (window.top !== window) return;
  const B = (window.__boot = { preFoundry: typeof globalThis.Hooks === "undefined" && typeof globalThis.game === "undefined", warn: [], error: [] });
  const text = (args) => args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300);
  for (const level of ["warn", "error"]) {
    const original = console[level];
    console[level] = (...args) => { B[level].push(text(args)); return original.apply(console, args); };
  }
  window.addEventListener("error", (e) => B.error.push("uncaught: " + String(e.message ?? "").slice(0, 200)));
})();`;

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async ({ key }) => {
    const H = (globalThis.__cs = globalThis.__cs ?? {});
    H.key = key;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.cards = (actorId) => [...game.messages].filter((m) => m.speaker?.actor === actorId).map((m) => m.id);
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.all = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { const line = args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300); H.errors.push(line); H.all.push(line); H.consoleError(...args); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      H.onRejection = (e) => H.uncaught.push("rejection: " + String(e.reason?.message ?? e.reason ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
    }
    return { isGM: game.user.isGM, userId: game.user.id, seam: typeof globalThis.acksExtras?.lib?.spellUse?.addClaimant === "function" };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** The world as `ready` left it: which wrapper path is live, and what the recorder saw. */
  boot: async () => {
    const b = window.__boot ?? null;
    return {
      recorded: !!b,
      preFoundry: !!b?.preFoundry,
      noWrapWarning: b ? !b.warn.some((w) => /no Item#_useSpell to wrap/u.test(w)) : null,
      noSpellUseError: b ? !b.error.some((e) => /spell-use/u.test(e)) : null,
      warns: b?.warn.length ?? null,
      errors: b?.error.length ?? null,
      libWrapperActive: !!game.modules.get("lib-wrapper")?.active,
      libWrapperApi: typeof globalThis.libWrapper?.register === "function",
      apiExposed: typeof game.modules.get("acks-extras")?.api?.lib?.spellUse?.addClaimant === "function" || typeof acksExtras?.lib?.spellUse?.addClaimant === "function",
    };
  },
  /** The wrapper reaches an embedded spell, a world item and the world's first item, each an instance of the class named at ready. */
  reach: async ({ casterId, spellId, worldId }) => {
    const H = globalThis.__cs;
    const Cls = CONFIG.Item.documentClass;
    const targets = { embedded: game.actors.get(casterId)?.items.get(spellId) ?? null, world: game.items.get(worldId) ?? null, first: game.items.contents[0] ?? null };
    const out = { class: {}, claimed: {}, countKept: {} };
    for (const [label, doc] of Object.entries(targets)) {
      if (!doc) { out.class[label] = null; out.claimed[label] = null; continue; }
      out.class[label] = doc instanceof Cls && doc.constructor === Cls;
      const before = doc.system?.cast ?? null;
      let calls = 0;
      acksExtras.lib.spellUse.addClaimant({ key: H.key, claims: (it) => it === doc, cast: async () => { calls += 1; } });
      try { await doc._useSpell({}); } finally { acksExtras.lib.spellUse.removeClaimant(H.key); }
      out.claimed[label] = calls;
      out.countKept[label] = (doc.system?.cast ?? null) === before;
    }
    return out;
  },
  /** A caster's known shape: spells enabled, the spell's count at 0, no claimant, an empty error list. */
  shape: async ({ casterId, spellId }) => {
    const H = globalThis.__cs;
    acksExtras.lib.spellUse.removeClaimant(H.key);
    const actor = game.actors.get(casterId);
    if (!actor.system.spells?.enabled) await actor.update({ "system.spells.enabled": true });
    const item = actor.items.get(spellId);
    await item.update({ "system.cast": 0 });
    H.errors.length = 0;
    H.uncaught.length = 0;
    H.late = null;
    H.calls = 0;
    return { cast: item.system.cast, spells: !!actor.system.spells?.enabled, isSpell: item.type === "spell" };
  },
  /** Register the walk's one claimant. `mode` picks its behaviour; every one claims this spell and nothing else, except `throwsClaims`, which throws for it. */
  claimant: async ({ spellId, mode }) => {
    const H = globalThis.__cs;
    const mine = (it) => it.id === spellId;
    const spec = {
      declines: { claims: () => false, cast: async () => { H.calls += 1; } },
      throwsClaims: { claims: (it) => { if (mine(it)) throw new Error("walk: claims threw"); return false; }, cast: async () => { H.calls += 1; } },
      neverSpends: { claims: mine, cast: async () => { H.calls += 1; } },
      spendsTwice: { claims: mine, cast: async (it, o, spend) => { H.calls += 1; await spend(); await spend(); } },
      throwsCast: { claims: mine, cast: async () => { H.calls += 1; throw new Error("walk: cast threw"); } },
      spendsUnawaited: { claims: mine, cast: async (it, o, spend) => { H.calls += 1; void spend(); } },
      // spend from a later callback, its answer read.
      spendsLateCaught: {
        claims: mine,
        cast: async (it, o, spend) => {
          H.calls += 1;
          H.late = { fired: false, threw: false, answer: null, rejected: false };
          setTimeout(() => {
            H.late.fired = true;
            try {
              Promise.resolve(spend()).then((v) => { H.late.answer = v; }, () => { H.late.rejected = true; });
            } catch { H.late.threw = true; }
          }, 300);
        },
      },
      // spend from a later callback with nothing catching or reading it, as a careless feature would.
      spendsLateBare: {
        claims: mine,
        cast: async (it, o, spend) => {
          H.calls += 1;
          H.late = { fired: false };
          setTimeout(() => { H.late.fired = true; spend(); }, 300);
        },
      },
    }[mode];
    if (!spec) return { ok: false };
    acksExtras.lib.spellUse.addClaimant({ key: H.key, ...spec });
    return { ok: true };
  },
  unclaim: async () => acksExtras.lib.spellUse.removeClaimant(globalThis.__cs.key),
  /** Open the caster's sheet on its Magic tab, press the spell row's cast button as a user does, and read the count and the new cards after the call settles. */
  press: async ({ casterId, spellId, expect = "none" }) => {
    const H = globalThis.__cs;
    const actor = game.actors.get(casterId);
    const item = actor.items.get(spellId);
    await actor.sheet.render(true);
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("magic", "primary");
    await H.sleep(500);
    const button = H.root(actor.sheet)?.querySelector(`[data-item-id='${spellId}'] [data-action='spellCast']`);
    if (!button) return { button: false };
    const before = item.system.cast;
    const seen = new Set(H.cards(casterId));
    const errorsBefore = H.errors.length;
    button.click();
    if (expect === "spend") {
      // The write and the card each arrive when the server and the template load allow, so wait on them; a beat more catches a second one.
      await H.poll(() => item.system.cast > before, { tries: 60, every: 200 });
      await H.poll(() => H.cards(casterId).some((id) => !seen.has(id)), { tries: 60, every: 200 });
      await H.sleep(700);
    } else {
      // No spend is expected, so there is nothing to wait on: a fixed beat, long enough for a late one.
      await H.sleep(2500);
    }
    const cards = H.cards(casterId).filter((id) => !seen.has(id));
    return {
      button: true,
      before,
      after: item.system.cast,
      cards: cards.length,
      cardIds: cards,
      claimantCalls: H.calls,
      logged: H.errors.slice(errorsBefore).map((e) => (/threw in claims/u.test(e) ? "claims" : /threw in cast; nothing was spent/u.test(e) ? "cast-nothing" : /threw in cast; the cast was already spent/u.test(e) ? "cast-spent" : /called spend after its cast returned; the cast was not counted/u.test(e) ? "late-spend" : /Error detected in module/u.test(e) ? "module-notice" : "other")),
    };
  },
  /** What the late `spend` did once its timer had fired (the timer is 300 ms; `press` settles longer). */
  late: async () => {
    const H = globalThis.__cs;
    return { late: H.late ?? null, uncaught: H.uncaught.length };
  },
  /** Cards speaking as the walk's own casters that no press recorded, split by whether they were made inside this run's window. */
  leftovers: async ({ actorIds, known, from, to }) => {
    const H = globalThis.__cs;
    const unrecorded = actorIds.flatMap((id) => H.cards(id)).filter((id) => !known.includes(id));
    const inside = unrecorded.filter((id) => { const t = game.messages.get(id)?.timestamp ?? 0; return t >= from && t <= to; });
    return { inside, outside: unrecorded.length - inside.length };
  },
  close: async ({ casterId }) => { await game.actors.get(casterId)?.sheet?.close(); return true; },
  drain: async () => ({ errors: globalThis.__cs.all.slice() }),
  restore: async () => {
    const H = globalThis.__cs;
    if (!H?.patched) return "never installed";
    try { acksExtras.lib.spellUse.removeClaimant(H.key); } catch { /* the seam may not exist */ }
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

async function ready(api, label, { seconds = 240, fresh = false } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib?.spellUse && ${fresh ? "!window.__preReload" : "true"}`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/**
 * Attach a second DevTools session to the GM seat's page, register the boot
 * recorder for the next document, and reload: the driver's own session attaches
 * after `ready`, so a recorder it injects would miss `init`, `setup` and `ready`.
 */
async function reloadWithRecorder(api) {
  const version = await (await fetch(`http://127.0.0.1:${PORTS.gm}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const cdp = new Cdp(ws);
  try {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const page = targetInfos.find((t) => t.type === "page" && t.url.includes("/game"));
    if (!page) throw new Error("no /game page to reload");
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    const { identifier } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOT_RECORDER }, sessionId);
    await api.eval("window.__preReload = true; 0");
    await cdp.send("Page.reload", {}, sessionId);
    const seconds = await ready(api, "gm after reload", { fresh: true });
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId).catch(() => {});
    return seconds;
  } finally {
    try { ws.close(); } catch {}
  }
}

let gm = null;
let player = null;
const cards = [];
const casterIds = [];
const RUN_START = Date.now();
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 480_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

/** Tracks the cards a press made, by id, so the sweep deletes exactly these. */
const keep = async (result) => {
  for (const id of result?.cardIds ?? []) { const uuid = `ChatMessage.${id}`; cards.push(uuid); await gm.track(uuid, "ChatMessage"); }
  return result;
};

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("gm reloaded with the boot recorder, ready after (s)", await reloadWithRecorder(gm));
  const installed = await run(gm, P.install, { key: KEY });
  check("the GM seat is a GM, and the cast seam is on the lib api", installed.isGM && installed.seam, installed);
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");

  section("fixtures");
  const own = (id) => ({ ownership: { default: 0, ...(id ? { [id]: 3 } : {}) } });
  const caster = await gm.fixture(CASTER, "Actor", { name: "QA Cast Seam Caster", type: "character", system: { spells: { enabled: true } }, ...own(null) });
  const casterP = await gm.fixture(CASTER_P, "Actor", { name: "QA Cast Seam Caster Player", type: "character", system: { spells: { enabled: true } }, ...own(playerId) });
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const casterId = idOf(caster);
  const casterPId = idOf(casterP);
  casterIds.push(casterId, casterPId);
  const spell = await gm.fixture(SPELL, "Item", { name: "QA Cast Seam Spell", type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const spellP = await gm.fixture(SPELL_P, "Item", { name: "QA Cast Seam Spell Player", type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: casterP.uuid });
  const world = await gm.fixture(WORLD, "Item", { name: "QA Cast Seam World Spell", type: "spell" });
  const spellId = idOf(spell);
  const spellPId = idOf(spellP);
  const worldId = idOf(world);
  const shaped = await run(gm, P.shape, { casterId, spellId });
  check("shape: the GM caster has spells enabled and its spell's count at 0", shaped.spells && shaped.isSpell && shaped.cast === 0, shaped);

  section("1. the boot recorder, and the wrapper on the class named at ready");
  const boot = await run(gm, P.boot);
  check("the recorder ran before Foundry's scripts and saw the load", boot.recorded && boot.preFoundry, { warns: boot.warns, errors: boot.errors });
  check("no 'no Item#_useSpell to wrap' warning was recorded across init, setup and ready", boot.noWrapWarning === true);
  check("no error naming the cast seam was recorded across the load", boot.noSpellUseError === true);
  note("libWrapper active / api", { active: boot.libWrapperActive, api: boot.libWrapperApi });
  check("the cast seam is on both the lib api and the module's api", boot.apiExposed);
  const reach = await run(gm, P.reach, { casterId, spellId, worldId });
  check("an embedded spell and a world item are instances of the class named at ready", reach.class.embedded === true && reach.class.world === true, reach.class);
  check("a claimant takes a cast on an embedded spell and on a world item, and the count stays put", reach.claimed.embedded === 1 && reach.claimed.world === 1 && reach.countKept.embedded && reach.countKept.world, { claimed: reach.claimed, kept: reach.countKept });
  check("the world's first item, when there is one, is that class and the claimant takes its cast too", reach.claimed.first === null || (reach.class.first === true && reach.claimed.first === 1), { present: reach.claimed.first !== null, class: reach.class.first, claimed: reach.claimed.first });

  section("2. no claimant: the Magic tab's cast button is the system's own");
  await run(gm, P.shape, { casterId, spellId });
  const plain = await keep(await run(gm, P.press, { casterId, spellId, expect: "spend" }));
  check("the button exists on the Magic tab's spell row", plain.button);
  check("the cast count rises by exactly 1 and the system's card posts once", plain.after === plain.before + 1 && plain.cards === 1, { before: plain.before, after: plain.after, cards: plain.cards });

  section("3. a claimant that declines, and a throwing claims");
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "declines" });
  const declined = await keep(await run(gm, P.press, { casterId, spellId, expect: "spend" }));
  check("a claimant whose claims is false is skipped: the count rises by 1, one card", declined.after === 1 && declined.cards === 1 && declined.claimantCalls === 0, { after: declined.after, cards: declined.cards, calls: declined.claimantCalls });
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "throwsClaims" });
  const thrown = await keep(await run(gm, P.press, { casterId, spellId, expect: "spend" }));
  check("a throwing claims falls through to the system: the count rises by 1, one card, and the throw is logged", thrown.after === 1 && thrown.cards === 1 && thrown.logged.includes("claims"), { after: thrown.after, cards: thrown.cards, logged: thrown.logged });

  section("4. a claimant that takes the cast");
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "neverSpends" });
  const never = await keep(await run(gm, P.press, { casterId, spellId }));
  check("a claimant that never spends leaves the count unchanged and posts no card", never.after === 0 && never.cards === 0 && never.claimantCalls === 1, { after: never.after, cards: never.cards, calls: never.claimantCalls });
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "spendsTwice" });
  const twice = await keep(await run(gm, P.press, { casterId, spellId, expect: "spend" }));
  check("a claimant that calls spend twice raises the count by exactly 1 and posts one card", twice.after === 1 && twice.cards === 1 && twice.claimantCalls === 1, { after: twice.after, cards: twice.cards, calls: twice.claimantCalls });
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "throwsCast" });
  const broke = await keep(await run(gm, P.press, { casterId, spellId }));
  check("a throwing cast spends nothing and is logged", broke.after === 0 && broke.cards === 0 && broke.logged.includes("cast-nothing"), { after: broke.after, cards: broke.cards, logged: broke.logged });
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "spendsUnawaited" });
  const unawaited = await keep(await run(gm, P.press, { casterId, spellId, expect: "spend" }));
  check("a spend the claimant started and did not await still lands under libWrapper: count 1, one card", unawaited.after === 1 && unawaited.cards === 1, { after: unawaited.after, cards: unawaited.cards });

  section("5. spend after cast has returned (libWrapper's invalid chain)");
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "spendsLateCaught" });
  const lateCaught = await keep(await run(gm, P.press, { casterId, spellId }));
  const lateInfo = await run(gm, P.late);
  check("the late spend's timer fired", lateInfo.late?.fired === true);
  check("a late spend resolves false and throws nothing into its caller", lateInfo.late?.answer === false && !lateInfo.late?.threw && !lateInfo.late?.rejected, lateInfo.late);
  check("a late spend never double-counts or posts: the count and the cards stay at 0", lateCaught.after === 0 && lateCaught.cards === 0, { after: lateCaught.after, cards: lateCaught.cards });
  check("the seam logs the late spend once, and Foundry raises no module-error notice", lateCaught.logged.filter((l) => l === "late-spend").length === 1 && !lateCaught.logged.includes("module-notice"), lateCaught.logged);
  check("no uncaught window error came of it", lateInfo.uncaught === 0, lateInfo.uncaught);
  await run(gm, P.shape, { casterId, spellId });
  await run(gm, P.claimant, { spellId, mode: "spendsLateBare" });
  const lateBare = await keep(await run(gm, P.press, { casterId, spellId }));
  const bareInfo = await run(gm, P.late);
  check("a late spend that nobody reads or catches fired, counted nothing and posted nothing", bareInfo.late?.fired === true && lateBare.after === 0 && lateBare.cards === 0, { after: lateBare.after, cards: lateBare.cards });
  check("the bare late spend logs once, raises no Foundry module-error notice and no uncaught window error", lateBare.logged.filter((l) => l === "late-spend").length === 1 && !lateBare.logged.includes("module-notice") && bareInfo.uncaught === 0, { logged: lateBare.logged, uncaught: bareInfo.uncaught });

  section("6. the claimant is removed");
  await run(gm, P.shape, { casterId, spellId });
  const removedAgain = await keep(await run(gm, P.press, { casterId, spellId, expect: "spend" }));
  check("with the claimant gone the button is the system's again: count 1, one card", removedAgain.after === 1 && removedAgain.cards === 1, { after: removedAgain.after, cards: removedAgain.cards });
  await run(gm, P.close, { casterId });

  section("7. a Player seat, on a Player-owned copy, with no claimant");
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  const pInstalled = await run(player, P.install, { key: KEY });
  check("the Player seat is not a GM, and sees the cast seam", !pInstalled.isGM && pInstalled.seam, pInstalled);
  await run(gm, P.shape, { casterId: casterPId, spellId: spellPId });
  await run(player, P.shape, { casterId: casterPId, spellId: spellPId });
  const viaPlayer = await keep(await run(player, P.press, { casterId: casterPId, spellId: spellPId, expect: "spend" }));
  check("the Player's cast button raises the count by exactly 1 and posts the system's card once", viaPlayer.button && viaPlayer.after === viaPlayer.before + 1 && viaPlayer.cards === 1, { before: viaPlayer.before, after: viaPlayer.after, cards: viaPlayer.cards });
  await run(player, P.close, { casterId: casterPId });

  const pe = await run(player, P.drain);
  const ge = await run(gm, P.drain);
  check("no console error on the Player seat over the walk", !pe.errors.length, pe.errors.slice(0, 3));
  // The seam logs its claimants' throws and late spends on purpose; nothing else may reach the console, Foundry's module-error notice included.
  const stray = ge.errors.filter((e) => !/spell-use claimant/u.test(e));
  check("no console error on the GM seat over the walk but the seam's own logged claimant errors", !stray.length, stray.slice(0, 3));
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  for (const seat of [gm, player]) {
    try { if (seat) await run(seat, P.unclaim); } catch { /* the seat may be gone */ }
  }
  if (gm && casterIds.length) {
    try {
      const known = cards.map((u) => u.split(".").pop());
      // Only a card made inside this run's own window is its leaving; the rest is not this run's and stays.
      const left = await run(gm, P.leftovers, { actorIds: casterIds, known, from: RUN_START - 5000, to: Date.now() + 5000 });
      for (const id of left.inside) { cards.push(`ChatMessage.${id}`); await gm.track(`ChatMessage.${id}`, "ChatMessage"); }
      note("unrecorded cards made inside this run's window (listed above by track, swept below)", left.inside.length);
      note("unrecorded cards outside the window, left standing", left.outside);
    } catch (err) { console.error("leftover cards:", err?.message ?? err); }
  }
  if (gm && cards.length) {
    try { note("cards swept", await gm.sweepTracked({ only: cards })); } catch (err) { console.error("card sweep:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixtures kept: ${CASTER}, ${SPELL}, ${CASTER_P}, ${SPELL_P}, ${WORLD}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
