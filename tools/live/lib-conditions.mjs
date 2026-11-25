/**
 * Live walk, lib-conditions: a figure the system's condition effect carries is
 * counted once, on a character and on an unlinked monster token.
 * Walks docs/lib/TESTING.md, "The system's condition effects carry their
 * figures", steps 1 to 6.
 * Machine values arrive through ./_env.mjs. No book is needed and no figure is
 * written here: every expected step is read from the effect the system's own
 * entry makes, in the page, and the walk prints whether a reading matched,
 * never the reading.
 *
 * Fixtures, kept and found by marker: the character `lib/core-cond-pc` with its
 * weapon `lib/core-cond-pc-weapon`, the monster `lib/core-cond-monster` with
 * its weapon `lib/core-cond-monster-weapon`, the monster
 * `lib/core-cond-waiver-monster` with its weapon
 * `lib/core-cond-waiver-weapon` and its ability `lib/conditions-waiver`, the
 * scene `lib/core-cond-scene`, and on it the linked token
 * `lib/core-cond-pc-token` and the unlinked tokens
 * `lib/core-cond-monster-token` and `lib/core-cond-waiver-token`. Each step
 * writes the shape it needs first. The run's own products (the cards its rolls
 * post, and step 5's hand-made effect) are tracked and swept; the fixtures
 * stay.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
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
const gap = (label, why) => console.log(`GAP  ${label}  ${why}`);

/** The conditions the walk expects the system to ship changes for; a different list is a finding. */
const CARRYING = ["berserk", "blessed", "blinded", "charging", "disordered", "hungry", "infuriated", "inspired", "prone", "queasy", "shaken"];
/** The condition the kept waiver ability names; it has an Armor Class change. */
const WAIVED = "disordered";

const weapon = (name) => ({ name, type: "weapon", system: { melee: true, missile: false, damage: { base: { formula: "1d6" } } } });
const waiver = () => ({
  name: "Core Condition Waiver", type: "ability",
  flags: { "acks-extras": { extras: { effects: [{ type: "modifier", target: "acWaiver", conditions: [WAIVED] }] } } },
});

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__lcBoot = { phase: "load", phases: [], errors: [] });
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
  install: async ({ sceneId }) => {
    const H = (globalThis.__lc = globalThis.__lc ?? {});
    H.RM = await import("/modules/acks-extras/scripts/lib/roll-mods.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.signed = (c) => (c.type === "subtract" ? -1 : 1) * Number(c.value);
    H.core = (id) => (CONFIG.ACKS?.conditions ?? []).find((c) => c.id === id) ?? null;
    /** A condition's changes summed by key, read from the system's own entry. */
    H.byKey = (id) => {
      const out = {};
      for (const c of H.core(id)?.system?.changes ?? []) out[c.key] = (out[c.key] ?? 0) + H.signed(c);
      return out;
    };
    if (!H.chatHook) {
      H.posted = [];
      H.chatHook = Hooks.on("createChatMessage", (m) => { if (m.author?.isSelf) H.posted.push(m.id); });
      H.seen = [];
      H.attackHook = Hooks.on("acksLibPostAttackRoll", (actor, ctx) => { H.seen.push({ actor: actor.uuid, math: ctx.conditions ?? null }); });
    }
    /** One melee attack by `tok` on `foe`, the die held, with the condition math the contributor read. */
    H.attack = async (tok, foe) => {
      canvas.tokens.setTargets([foe.id], { mode: "replace" });
      await H.sleep(120);
      const actor = tok.actor;
      const item = actor.items.find((i) => i.type === "weapon");
      const mark = H.seen.length;
      const sent = H.posted.length;
      const o = await actor.makeAttackThrow({ item, attackType: "melee", skipDialog: true });
      for (let n = 0; n < 30 && H.posted.length === sent; n++) await H.sleep(100);
      const math = H.seen.slice(mark).find((s) => s.actor === actor.uuid)?.math?.melee ?? null;
      return {
        rolled: !!o,
        total: Number(o?.resolution?.total), targetValue: Number(o?.resolution?.targetValue),
        modifiers: (o?.result?.attack?.modifiers ?? []).map((m) => ({ label: m.label, value: Number(m.value) })),
        terms: (math?.terms ?? []).map((t) => ({ condition: t.condition, value: Number(t.value), side: t.side ?? null })),
        waived: (math?.waived ?? []).map((t) => ({ condition: t.condition, value: Number(t.value) })),
        card: H.posted[sent] ?? null,
      };
    };
    /** One saving throw, the die held: what the roll came to and the number it had to reach. */
    H.save = async (actor) => {
      const skip = game.settings.get("acks", "skip-dialog-key");
      const r = await actor.rollSave("death", { event: { [skip]: true } });
      await H.sleep(150);
      return { total: Number(r?.total), target: Number(r?.data?.roll?.target) };
    };
    H.uniform = H.uniform ?? CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => 0.5;
    const scene = game.scenes.get(sceneId);
    if (scene && canvas.scene?.id !== sceneId) { await scene.view(); await H.sleep(1500); }
    return {
      user: game.user.name, isGM: game.user.isGM, role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      viewing: canvas.scene?.id === sceneId,
      boot: globalThis.__lcBoot ?? null,
    };
  },
  /** What the palette registered for the system's conditions. */
  census: async () => {
    const H = globalThis.__lc;
    const entry = (id) => CONFIG.statusEffects.find((s) => s.id === id) ?? null;
    const carrying = (CONFIG.ACKS?.conditions ?? []).filter((c) => (c.system?.changes ?? []).length);
    const plain = (CONFIG.ACKS?.conditions ?? []).filter((c) => !(c.system?.changes ?? []).length);
    return {
      carrying: carrying.map((c) => c.id),
      registered: carrying.map((c) => {
        const e = entry(c.id);
        return {
          id: c.id, present: !!e,
          sameChanges: JSON.stringify(e?.system?.changes ?? null) === JSON.stringify(c.system.changes),
          moduleName: !!e && e.name !== c.name && game.i18n.has(String(e.name)),
          keys: c.system.changes.map((x) => x.key),
        };
      }),
      plainWithChanges: plain.filter((c) => (entry(c.id)?.system?.changes ?? []).length).map((c) => c.id),
      readied: !!entry("readied") && entry("readied").hud !== false,
      delayed: !!entry("delayed") && entry("delayed").hud !== false,
      keysRead: H.RM.CONDITION_STEP_KEYS,
      playersSeeTargetAc: !!game.settings.get("acks", "showTargetACToPlayers"),
    };
  },
  /** Bring a fixture token to the shape every step starts from: none of the conditions, no target. */
  shape: async ({ tokens, ids, waiverItem, waived }) => {
    const lifted = [];
    for (const uuid of tokens) {
      const actor = (await fromUuid(uuid)).actor;
      for (const id of ids) {
        while (actor.effects.some((e) => e.statuses.has(id))) {
          const e = actor.effects.find((x) => x.statuses.has(id));
          await e.delete();
          lifted.push(id);
        }
      }
    }
    if (waiverItem) {
      const item = await fromUuid(waiverItem);
      await item.update({ "flags.acks-extras.extras.effects": [{ type: "modifier", target: "acWaiver", conditions: [waived] }] });
    }
    canvas.tokens.setTargets([]);
    return lifted;
  },
  /** One condition on one bearer: the effect, the fields, the reader, and the rolls each way against a clean foe. */
  one: async ({ id, bearer, foe }) => {
    const H = globalThis.__lc;
    const tok = await fromUuid(bearer);
    const foeTok = await fromUuid(foe);
    const actor = tok.actor;
    const want = H.byKey(id);
    const keys = Object.keys(want);
    const acKey = H.RM.CONDITION_STEP_KEYS.ac;
    const saveKey = H.RM.CONDITION_STEP_KEYS.save;
    const acStep = want[acKey] ?? 0;
    const saveStep = want[saveKey] ?? 0;
    const hitStep = want["system.attack.mod.melee"] ?? 0;
    const read = () => ({ fields: Object.fromEntries(keys.map((k) => [k, Number(foundry.utils.getProperty(actor, k))])), ac: Number(actor.system.ac.value) });
    const sum = (list) => list.reduce((t, x) => t + x.value, 0);
    const reader = (key) => H.RM.conditionSteps(actor, key).steps.filter((s) => s.condition === id).map((s) => ({ value: s.value }));

    const before = read();
    const save0 = await H.save(actor);
    const hit0 = await H.attack(tok, foeTok);
    const def0 = await H.attack(foeTok, tok);

    await actor.toggleStatusEffect(id, { active: true });
    await H.sleep(350);
    const effects = actor.effects.filter((e) => e.statuses.has(id));
    const eff = effects[0] ?? null;
    const carried = (eff?.system?.changes ?? eff?.changes ?? []).map((c) => ({ key: c.key, type: c.type, value: Number(c.value) }));
    const shipped = (H.core(id)?.system?.changes ?? []).map((c) => ({ key: c.key, type: c.type, value: Number(c.value) }));
    const during = read();
    const acRead = reader(acKey);
    const saveRead = reader(saveKey);
    const save1 = await H.save(actor);
    const hit1 = await H.attack(tok, foeTok);
    const def1 = await H.attack(foeTok, tok);

    await actor.toggleStatusEffect(id, { active: false });
    await H.sleep(350);
    const after = read();
    canvas.tokens.setTargets([]);

    const named = hit1.modifiers.filter((m) => m.label === eff?.name);
    const ownTerms = hit1.terms.filter((t) => t.condition === id);
    const against = def1.terms.filter((t) => t.condition === id && t.side === "target");
    const others = sum(def1.terms.filter((t) => !(t.condition === id && t.side === "target")));
    const hitOthers = sum(hit1.terms);
    return {
      id, type: actor.type, keys,
      has: { ac: acStep !== 0, save: saveStep !== 0, hit: hitStep !== 0 },
      oneEffect: effects.length === 1,
      carries: JSON.stringify(carried) === JSON.stringify(shipped) && carried.length > 0,
      fieldsOnce: keys.every((k) => during.fields[k] - before.fields[k] === want[k]),
      acValueMoved: during.ac !== before.ac,
      acValueBy: Math.abs(during.ac - before.ac) === Math.abs(acStep),
      readerAc: acRead.length === (acStep ? 1 : 0) && sum(acRead) === acStep,
      readerSave: saveRead.length === (saveStep ? 1 : 0) && sum(saveRead) === saveStep,
      rolled: [hit0, hit1, def0, def1].every((r) => r.rolled && Number.isFinite(r.total) && Number.isFinite(r.targetValue)),
      // The bearer's own throw: the system names the effect once, and the throw moves by its step.
      hitNamedOnce: named.length === (hitStep ? 1 : 0) && sum(named) === hitStep,
      hitNoModuleTerm: ownTerms.length === 0,
      hitOnce: (hit1.total - hit0.total) - (hit1.targetValue - hit0.targetValue) - hitOthers === hitStep,
      // A throw against the bearer: the Armor Class step reaches it once, by the field or by a term.
      againstTerms: against.length,
      againstTermIsStep: against.length === 1 && against[0].value === -acStep,
      againstTargetMoved: def1.targetValue !== def0.targetValue,
      againstOnce: (def1.total - def0.total) - (def1.targetValue - def0.targetValue) - others === -acStep,
      // The bearer's save: the step reaches it once, on the roll or on the number to reach.
      saveRolled: [save0, save1].every((r) => Number.isFinite(r.total) && Number.isFinite(r.target)),
      saveOnce: (save1.total - save0.total) - (save1.target - save0.target) === saveStep,
      saveOnRoll: save1.total !== save0.total,
      saveOnTarget: save1.target !== save0.target,
      back: JSON.stringify(after) === JSON.stringify(before) && !actor.statuses.has(id),
    };
  },
  /** The waiver: a waived condition's step is reported and not applied; another's stands. */
  waiver: async ({ bearer, foe, waived, other }) => {
    const H = globalThis.__lc;
    const tok = await fromUuid(bearer);
    const foeTok = await fromUuid(foe);
    const actor = tok.actor;
    const acKey = H.RM.CONDITION_STEP_KEYS.ac;
    const stepOf = (id) => H.byKey(id)[acKey] ?? 0;
    const clean = await H.attack(foeTok, tok);
    await actor.toggleStatusEffect(waived, { active: true });
    await H.sleep(350);
    const read = H.RM.conditionSteps(actor, acKey);
    const one = await H.attack(foeTok, tok);
    await actor.toggleStatusEffect(other, { active: true });
    await H.sleep(350);
    const two = await H.attack(foeTok, tok);
    await actor.toggleStatusEffect(other, { active: false });
    await actor.toggleStatusEffect(waived, { active: false });
    await H.sleep(350);
    canvas.tokens.setTargets([]);
    const term = (r, id) => r.terms.filter((t) => t.condition === id && t.side === "target");
    return {
      type: actor.type,
      hasStep: stepOf(waived) !== 0 && stepOf(other) !== 0,
      readerWaived: read.steps.length === 0 && read.waived.length === 1 && read.waived[0].condition === waived && read.waived[0].value === stepOf(waived),
      noTerm: term(one, waived).length === 0,
      toldWaived: one.waived.length === 1 && one.waived[0].condition === waived && one.waived[0].value === -stepOf(waived),
      throwUnmoved: one.total - clean.total === 0 && one.targetValue === clean.targetValue,
      otherStands: term(two, other).length === 1 && term(two, other)[0].value === -stepOf(other) && term(two, waived).length === 0,
      back: !actor.statuses.has(waived) && !actor.statuses.has(other),
    };
  },
  /** An effect that names a condition and carries no change, as one made before the palette carried them. */
  bare: async ({ bearer, id }) => {
    const H = globalThis.__lc;
    const actor = (await fromUuid(bearer)).actor;
    const keys = Object.keys(H.byKey(id));
    const read = () => keys.map((k) => Number(foundry.utils.getProperty(actor, k)));
    const before = read();
    const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [{ name: "Core Condition Bare", statuses: [id] }]);
    await H.sleep(350);
    const out = {
      uuid: made.uuid,
      carried: actor.statuses.has(id),
      fieldsUnmoved: JSON.stringify(read()) === JSON.stringify(before),
      readerNone: keys.every((k) => H.RM.conditionSteps(actor, k).steps.length === 0),
    };
    return out;
  },
  /** The bearer's condition on, a foe's attack on it, and the card that attack posted. */
  cardAttack: async ({ bearer, foe, id }) => {
    const H = globalThis.__lc;
    const tok = await fromUuid(bearer);
    const foeTok = await fromUuid(foe);
    if (id) { await tok.actor.toggleStatusEffect(id, { active: true }); await H.sleep(350); }
    const eff = id ? tok.actor.effects.find((e) => e.statuses.has(id)) : null;
    const r = await H.attack(foeTok, tok);
    await H.sleep(400);
    const message = game.messages.get(r.card);
    if (id) { await tok.actor.toggleStatusEffect(id, { active: false }); await H.sleep(350); }
    canvas.tokens.setTargets([]);
    return {
      card: r.card, name: eff?.name ?? null,
      isAttackCard: /attack-throw-card/.test(message?.content ?? ""),
      whispered: (message?.whisper?.length ?? 0) > 0,
      terms: r.terms.filter((t) => t.condition === id && t.side === "target").length,
      contentUntouched: !/acks-extras-/.test(message?.content ?? ""),
    };
  },
  /** How one seat's client draws a card: the module's line in the footer, by the visibility each span is marked with. */
  cardRead: async ({ card, name }) => {
    const message = game.messages.get(card);
    if (!message) return { visible: false };
    const draw = async () => {
      const el = await message.renderHTML();
      const lines = [...el.querySelectorAll(".attack-throw-card__footer [data-acks-visibility]")].filter((n) => [...n.classList].some((c) => c.startsWith("acks-extras-")) || n.closest("[class*='acks-extras-']"));
      const of = (v) => lines.filter((n) => n.dataset.acksVisibility === v);
      const text = (n) => n.textContent.replace(/\s+/g, " ").trim();
      const tip = (n) => n.dataset.tooltipText ?? n.closest("[data-tooltip-text]")?.dataset.tooltipText ?? "";
      return {
        shown: of("target-ac-shown").map((n) => ({ named: !!name && text(n).includes(name), digits: /\d/.test(text(n)), tipNamed: !!name && tip(n).includes(name), title: n.hasAttribute("title") })),
        hidden: of("target-ac-hidden").map((n) => ({ named: !!name && text(n).includes(name), digits: /\d/.test(text(n)), tipDigits: /\d/.test(tip(n).replace(/\([^)]*\)/g, "")), title: n.hasAttribute("title") })),
      };
    };
    const first = await draw();
    const second = await draw();
    return {
      visible: true,
      canSeeTargetAc: game.user.isGM || !!game.settings.get("acks", "showTargetACToPlayers"),
      first, sameTwice: JSON.stringify(first) === JSON.stringify(second),
    };
  },
  drain: async () => ({ posted: globalThis.__lc?.posted?.slice() ?? [] }),
  restore: async () => {
    const H = globalThis.__lc;
    if (!H) return "never installed";
    if (H.uniform) { CONFIG.Dice.randomUniform = H.uniform; H.uniform = null; }
    if (H.chatHook) { Hooks.off("createChatMessage", H.chatHook); H.chatHook = null; }
    if (H.attackHook) { Hooks.off("acksLibPostAttackRoll", H.attackHook); H.attackHook = null; }
    globalThis.canvas?.tokens?.setTargets([]);
    return "restored";
  },
};

async function run(api, fn, arg) {
  const text = await api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)}).then((v) => JSON.stringify(v === undefined ? null : v))`, 120000);
  return JSON.parse(text);
}
async function ready(api, label, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.lib`); } catch { ok = false; }
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

  section("fixtures");
  const pc = await gm.fixture("lib/core-cond-pc", "Actor", { name: "Core Condition PC", type: "character" });
  const mon = await gm.fixture("lib/core-cond-monster", "Actor", { name: "Core Condition Monster", type: "monster" });
  const spared = await gm.fixture("lib/core-cond-waiver-monster", "Actor", { name: "Core Condition Waiver Monster", type: "monster" });
  await gm.fixture("lib/core-cond-pc-weapon", "Item", weapon("Core Condition Blade"), { parent: pc.uuid });
  await gm.fixture("lib/core-cond-monster-weapon", "Item", weapon("Core Condition Claw"), { parent: mon.uuid });
  await gm.fixture("lib/core-cond-waiver-weapon", "Item", weapon("Core Condition Claw"), { parent: spared.uuid });
  const waiverItem = await gm.fixture("lib/conditions-waiver", "Item", waiver(), { parent: spared.uuid });
  const scene = await gm.fixture("lib/core-cond-scene", "Scene", { name: "Core Condition Probe", width: 1200, height: 800, grid: { size: 100 } });
  const monTok = await gm.fixture("lib/core-cond-monster-token", "Token", { name: "Core Condition Monster", actorId: mon.id, actorLink: false, x: 300, y: 300 }, { parent: scene.uuid });
  const pcTok = await gm.fixture("lib/core-cond-pc-token", "Token", { name: "Core Condition PC", actorId: pc.id, actorLink: true, x: 500, y: 300 }, { parent: scene.uuid });
  const sparedTok = await gm.fixture("lib/core-cond-waiver-token", "Token", { name: "Core Condition Waiver Monster", actorId: spared.id, actorLink: false, x: 700, y: 300 }, { parent: scene.uuid });

  const g = await run(gm, P.install, { sceneId: scene.id });
  const p = await run(player, P.install, { sceneId: scene.id });
  note("installed", { gm: g.user, player: p.user, viewing: g.viewing });
  check("the GM seat is the active GM, and the player seat is a player", g.isGM && g.activeGMIsSelf && !p.isGM, { gm: g.role, player: p.role });
  if (!g.activeGMIsSelf) blocked("another client is the active GM; the automation would run there");
  for (const [key, c] of Object.entries({ gm: g, player: p })) check(`${key} seat: no error from load through ready`, c.boot?.phases.length === 3 && !c.boot.errors.length, c.boot);
  note("shape: lifted", await run(gm, P.shape, { tokens: [pcTok.uuid, monTok.uuid, sparedTok.uuid], ids: CARRYING, waiverItem: waiverItem.uuid, waived: WAIVED }));

  section("1. the palette registers the system's entries");
  const census = await run(gm, P.census);
  note("census", { carrying: census.carrying, keys: Object.fromEntries(census.registered.map((r) => [r.id, r.keys])), playersSeeTargetAc: census.playersSeeTargetAc });
  check("1: the system ships changes for the conditions this walk names, and no other", JSON.stringify([...census.carrying].sort()) === JSON.stringify([...CARRYING].sort()), census.carrying);
  check("1: each one's entry in CONFIG.statusEffects carries the system's changes, under the module's name", census.registered.every((r) => r.present && r.sameChanges && r.moduleName), census.registered.filter((r) => !(r.present && r.sameChanges && r.moduleName)).map((r) => r.id));
  check("1: no entry carries a change the system does not ship for it, and Readied and Delayed are on the palette", census.plainWithChanges.length === 0 && census.readied && census.delayed, { extra: census.plainWithChanges, readied: census.readied, delayed: census.delayed });

  const failing = (rows, key) => rows.filter((r) => !r[key]).map((r) => r.id);
  for (const [n, kind, bearer, foe] of [[2, "a character", pcTok, monTok], [3, "an unlinked monster token", monTok, pcTok]]) {
    section(`${n}. each condition on ${kind}`);
    const rows = [];
    for (const id of census.carrying) {
      rows.push(await run(gm, P.one, { id, bearer: bearer.uuid, foe: foe.uuid }));
    }
    const character = kind === "a character";
    note("read", rows.map((r) => ({ id: r.id, type: r.type, has: r.has, onRoll: r.saveOnRoll, onTarget: r.saveOnTarget, terms: r.againstTerms })));
    check(`${n}: every roll was made and read`, rows.every((r) => r.rolled && r.saveRolled), failing(rows, "rolled"));
    check(`${n}: a toggle makes one effect that carries the system's changes`, rows.every((r) => r.oneEffect && r.carries), [...failing(rows, "oneEffect"), ...failing(rows, "carries")]);
    check(`${n}: every field a change names moves by that change, once`, rows.every((r) => r.fieldsOnce), failing(rows, "fieldsOnce"));
    check(`${n}: the step reader answers each Armor Class and save step from the effect, once`, rows.every((r) => r.readerAc && r.readerSave), [...failing(rows, "readerAc"), ...failing(rows, "readerSave")]);
    check(`${n}: the bearer's own throw names the effect once, carries no module term for it, and moves by its step`, rows.every((r) => r.hitNamedOnce && r.hitNoModuleTerm && r.hitOnce), { named: failing(rows, "hitNamedOnce"), term: failing(rows, "hitNoModuleTerm"), once: failing(rows, "hitOnce") });
    const withAc = rows.filter((r) => r.has.ac);
    const withSave = rows.filter((r) => r.has.save);
    check(`${n}: the walk met a condition with an Armor Class step and one with a save step`, withAc.length > 0 && withSave.length > 0, { ac: withAc.length, save: withSave.length });
    if (character) {
      check("2: the Armor Class value holds the step, and a throw against the character carries no term for it", withAc.every((r) => r.acValueMoved && r.acValueBy && r.againstTargetMoved) && rows.every((r) => r.againstTerms === 0), { value: failing(withAc, "acValueBy"), target: failing(withAc, "againstTargetMoved"), terms: rows.filter((r) => r.againstTerms).map((r) => r.id) });
      check("2: the save step is on the system's roll, and the number to reach does not move", withSave.every((r) => r.saveOnRoll && !r.saveOnTarget), withSave.filter((r) => !r.saveOnRoll || r.saveOnTarget).map((r) => r.id));
    } else {
      check("3: the Armor Class value does not move, and a throw against the monster carries one term, the step reversed", withAc.every((r) => !r.acValueMoved && r.againstTermIsStep && !r.againstTargetMoved) && rows.filter((r) => !r.has.ac).every((r) => r.againstTerms === 0), { value: withAc.filter((r) => r.acValueMoved).map((r) => r.id), term: failing(withAc, "againstTermIsStep"), stray: rows.filter((r) => !r.has.ac && r.againstTerms).map((r) => r.id) });
      check("3: the save step lowers the number to reach, and the system's roll does not move", withSave.every((r) => r.saveOnTarget && !r.saveOnRoll), withSave.filter((r) => !r.saveOnTarget || r.saveOnRoll).map((r) => r.id));
    }
    check(`${n}: a throw against the bearer counts the Armor Class step once, and one with no such step not at all`, rows.every((r) => r.againstOnce), failing(rows, "againstOnce"));
    check(`${n}: a save counts the save step once, and one with no such step not at all`, rows.every((r) => r.saveOnce), failing(rows, "saveOnce"));
    check(`${n}: lifting the condition puts every field back`, rows.every((r) => r.back), failing(rows, "back"));
  }

  section("4. a waived Armor Class figure on a monster");
  const other = census.registered.find((r) => r.id !== WAIVED && r.keys.includes(census.keysRead.ac))?.id ?? null;
  note("conditions", { waived: WAIVED, other });
  if (!other) check("4: the system ships a second condition with an Armor Class change", false);
  else {
    const w = await run(gm, P.waiver, { bearer: sparedTok.uuid, foe: pcTok.uuid, waived: WAIVED, other });
    note("waiver", w);
    check("4: both conditions carry an Armor Class step", w.hasStep);
    check("4: the reader answers the waived condition's step as waived and not as a step", w.readerWaived);
    check("4: the throw carries no term for it, is told of it as waived, and does not move", w.noTerm && w.toldWaived && w.throwUnmoved, { term: w.noTerm, told: w.toldWaived, unmoved: w.throwUnmoved });
    check("4: a second condition the ability does not name keeps its term", w.otherStands && w.back);
  }

  section("5. an effect that names a condition and carries no change");
  const bareId = census.registered.find((r) => r.keys.includes(census.keysRead.ac))?.id ?? census.carrying[0];
  const bare = await run(gm, P.bare, { bearer: pcTok.uuid, id: bareId });
  swept.push(gm.track(bare.uuid));
  check("5: the actor has the condition, no field moves, and the reader answers no step", bare.carried && bare.fieldsUnmoved && bare.readerNone, { id: bareId, carried: bare.carried, unmoved: bare.fieldsUnmoved, reader: bare.readerNone });
  const sw5 = await gm.sweepTracked({ only: swept.splice(0) });
  note("sweep (step 5's effect)", { removed: sw5.removed.map((e) => e.uuid), missing: sw5.missing.map((e) => e.uuid), failed: sw5.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });

  section("6. the attack card names a condition inside a character target's Armor Class");
  const lineId = bareId;
  const onPc = await run(gm, P.cardAttack, { bearer: pcTok.uuid, foe: monTok.uuid, id: lineId });
  const onMon = await run(gm, P.cardAttack, { bearer: monTok.uuid, foe: pcTok.uuid, id: lineId });
  const clean = await run(gm, P.cardAttack, { bearer: pcTok.uuid, foe: monTok.uuid, id: null });
  note("cards", { onPc: { attack: onPc.isAttackCard, whispered: onPc.whispered }, onMon: { terms: onMon.terms }, clean: { attack: clean.isAttackCard } });
  check("6: the three attacks posted the system's attack card, and the stored content holds no module markup", [onPc, onMon, clean].every((c) => c.isAttackCard && c.contentUntouched));
  const gmPc = await run(gm, P.cardRead, { card: onPc.card, name: onPc.name });
  const gmMon = await run(gm, P.cardRead, { card: onMon.card, name: onMon.name });
  const gmClean = await run(gm, P.cardRead, { card: clean.card, name: null });
  note("gm reads", { pc: gmPc.first, mon: gmMon.first, clean: gmClean.first });
  check("6: the GM seat reads one line naming the effect with its step, a tooltip naming it, and no hidden line", gmPc.first.shown.length === 1 && gmPc.first.shown[0].named && gmPc.first.shown[0].digits && gmPc.first.shown[0].tipNamed && !gmPc.first.shown[0].title && gmPc.first.hidden.length === 0, gmPc.first);
  check("6: a second draw of the card holds the same one line", gmPc.sameTwice && gmMon.sameTwice && gmClean.sameTwice);
  check("6: a monster target's card and a clean character target's card hold no line", gmMon.first.shown.length + gmMon.first.hidden.length === 0 && gmClean.first.shown.length + gmClean.first.hidden.length === 0 && onMon.terms === 1, { mon: gmMon.first, clean: gmClean.first, terms: onMon.terms });
  let seen = null;
  for (let n = 0; n < 40 && !seen?.visible; n++) { seen = await run(player, P.cardRead, { card: onPc.card, name: onPc.name }); if (!seen.visible) await sleep(250); }
  if (onPc.whispered || !seen?.visible) gap("6: the Player seat's reading of the card", "this client's roll mode whispers its cards, so the Player seat holds no copy");
  else if (seen.canSeeTargetAc) {
    note("player reads (the world shows target Armor Class to players)", seen.first);
    check("6: the Player seat reads the line as the GM seat does", seen.first.shown.length === 1 && seen.first.shown[0].named && seen.first.hidden.length === 0 && seen.sameTwice, seen.first);
    gap("6: the line with target Armor Class hidden from players", "the world's setting shows it; the walk reads the setting and never writes it");
  } else {
    note("player reads (the world hides target Armor Class from players)", seen.first);
    check("6: the Player seat reads the name alone: no step on the line or in its tooltip, and no shown line", seen.first.hidden.length === 1 && seen.first.hidden[0].named && !seen.first.hidden[0].digits && !seen.first.hidden[0].tipDigits && !seen.first.hidden[0].title && seen.first.shown.length === 0 && seen.sameTwice, seen.first);
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  try {
    if (gm) {
      const { posted } = await run(gm, P.drain);
      for (const id of posted) swept.push(gm.track(id, "ChatMessage"));
      note("cards posted by this run", posted.length);
    }
  } catch (err) { console.error("drain gm:", err?.message ?? err); }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  try {
    if (gm && swept.length) {
      const sw = await gm.sweepTracked({ only: swept });
      note("sweep (gm)", { removed: sw.removed.length, missing: sw.missing.map((e) => e.uuid), failed: sw.failed.map((e) => ({ uuid: e.uuid, error: e.error })) });
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
