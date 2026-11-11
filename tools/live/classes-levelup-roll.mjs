/**
 * Live walk, classes-levelup-roll: the level-up wizard's hit points. Walks
 * docs/classes/TESTING.md "The wizard's kept roll" on the GM and Player seats:
 * the roll a climb offers is made once and survives a closed wizard and a
 * reloaded page; it is rolled again only for a different level, mode or
 * Constitution modifier; it is cleared by the climb and by a level moved under
 * it; the old maximum is the stored one, not one an effect raised; a class
 * printing no hit dice rolls nothing and says so; a level with no cell takes
 * the dice its class's rows print; and the Intellect bonus picks are the
 * system's own modifier. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: three classes with INVENTED level rows
 * (`classes/levelup-roll-class`, `classes/levelup-roll-gap-class`,
 * `classes/levelup-roll-nohd-class`) and `classes/levelup-roll-character`, a
 * character the Player seat owns, brought to a known shape at each step's
 * start. The run's own documents — the cards its climbs post and the effect it
 * adds — are tracked and swept by uuid. The hit-point mode setting and the
 * fixture's Constitution are restored in the finally. Every figure printed is
 * a boolean, or one of the invented classes' own.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MOD = "acks-extras";

/** Invented rows: no class prints these, and nothing here is read off a page. */
const ROWS = [
  { level: 1, xp: 0, title: "", hd: "1d6" },
  { level: 2, xp: 1000, title: "", hd: "2d6" },
  { level: 3, xp: 2000, title: "", hd: "3d6" },
  { level: 4, xp: 4000, title: "", hd: "4d6" },
];
/** A level with no cell between two that print one. */
const GAP_ROWS = [
  { level: 1, xp: 0, title: "", hd: "1d6" },
  { level: 2, xp: 1000, title: "", hd: "" },
  { level: 3, xp: 2000, title: "", hd: "3d6" },
];
/** Rows that print no hit dice at all. */
const NOHD_ROWS = [
  { level: 1, xp: 0, title: "", hd: "" },
  { level: 2, xp: 1000, title: "", hd: "" },
];
/** Two Constitution scores the system gives different modifiers. */
const CON = { plain: 10, high: 18 };

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__clBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__cl = globalThis.__cl ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 60, every = 200 } = {}) => {
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
    if (!H.patched) {
      H.patched = true;
      H.notes = [];
      H.errors = [];
      H.orig = {};
      for (const k of ["info", "warn", "error"]) {
        H.orig[k] = ui.notifications[k];
        ui.notifications[k] = function (msg, ...rest) {
          H.notes.push({ kind: k, text: String(msg) });
          return H.orig[k].call(this, msg, ...rest);
        };
      }
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      // Cards this client makes, kept by id: the only cards teardown may claim.
      H.cards = [];
      H.hook = Hooks.on("createChatMessage", (m) => { if (m.author?.id === game.user.id) H.cards.push({ id: m.id, actor: m.speaker?.actor ?? null }); });
    }
    return {
      isGM: game.user.isGM,
      role: game.user.role,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
      boot: globalThis.__clBoot ?? null,
      openLevelUp: typeof acksExtras?.classes?.openLevelUp === "function",
    };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** Bring the character to `start` on `classId`, Constitution `con`, no effects, no kept roll. */
  shape: async ({ actorId, classId, start, con, maxHp = null }) => {
    const actor = game.actors.get(actorId);
    const cls = game.items.get(classId);
    const MOD = "acks-extras";
    if (actor.effects.size) await actor.deleteEmbeddedDocuments("ActiveEffect", actor.effects.map((e) => e.id));
    await actor.update({ [`flags.${MOD}.classes`]: new foundry.data.operators.ForcedDeletion() });
    await actor.update({ "system.details.level": 1, "system.details.xp.value": 0, "system.scores.con.value": con, ...(maxHp != null ? { "system.hp.max": maxHp, "system.hp.value": maxHp } : {}) });
    const applied = await acksExtras.classes.applyClass(actor, cls, { level: start, confirm: false, rebuildVitals: true });
    const next = cls.system.nextXp(start);
    if (next != null) await actor.update({ "system.details.xp.value": next });
    return {
      applied: !!applied?.applied,
      level: actor.system.details.level,
      ready: next != null && actor.system.details.xp.value >= next,
      kept: actor.getFlag(MOD, "classes")?.levelUpRoll ?? null,
      storedMax: actor._source.system.hp.max,
      conMod: actor.system.scores.con.mod,
    };
  },
  /** The Class tab's Level up, clicked as a user would; answers what the wizard shows. */
  openWizard: async ({ actorId }) => {
    const H = globalThis.__cl;
    const actor = game.actors.get(actorId);
    for (const app of foundry.applications.instances.values()) if (H.root(app)?.querySelector(".acks-extras-classes-levelup-body")) await app.close({ animate: false });
    const entry = Object.values(CONFIG.Actor.sheetClasses.character).find((e) => e.cls?.name === "AcksCharacterSheet");
    let sheet = [...foundry.applications.instances.values()].find((a) => a.document === actor && a.constructor === entry?.cls);
    if (!sheet) sheet = new entry.cls({ document: actor });
    sheet.tabGroups.primary = "class";
    await sheet.render({ force: true });
    await H.sleep(600);
    const button = H.root(sheet)?.querySelector('[data-action="levelUp"]');
    if (!button) return { button: false };
    button.click();
    const dialog = await H.poll(() => [...foundry.applications.instances.values()].find((a) => H.root(a)?.querySelector(".acks-extras-classes-levelup-body")));
    if (!dialog) return { button: true, dialog: false };
    const body = H.root(dialog).querySelector(".acks-extras-classes-levelup-body");
    const line = [...body.querySelectorAll("p")].find((p) => /→/.test(p.textContent))?.textContent.trim() ?? "";
    const m = /(\d+)\s*→\s*(\d+)/.exec(line);
    return {
      button: true,
      dialog: true,
      line,
      oldMax: m ? Number(m[1]) : null,
      newMax: m ? Number(m[2]) : null,
      rolled: !!body.querySelector(".acks-extras-classes-refname"),
      hint: body.querySelector(".hint")?.textContent.trim() ?? null,
      kept: actor.getFlag("acks-extras", "classes")?.levelUpRoll ?? null,
      storedMax: actor._source.system.hp.max,
      preparedMax: actor.system.hp.max,
      conMod: actor.system.scores.con.mod,
    };
  },
  /** Close the open wizard without answering it. */
  closeWizard: async () => {
    const H = globalThis.__cl;
    const dialog = [...foundry.applications.instances.values()].find((a) => H.root(a)?.querySelector(".acks-extras-classes-levelup-body"));
    if (!dialog) return false;
    await dialog.close({ animate: false });
    await H.sleep(500);
    return true;
  },
  /** Press the open wizard's Apply and read the character after the climb lands. */
  applyWizard: async ({ actorId }) => {
    const H = globalThis.__cl;
    const actor = game.actors.get(actorId);
    const before = actor.system.details.level;
    const dialog = [...foundry.applications.instances.values()].find((a) => H.root(a)?.querySelector(".acks-extras-classes-levelup-body"));
    const ok = H.root(dialog)?.querySelector('button[data-action="ok"]');
    if (!ok) return { pressed: false };
    ok.click();
    await H.poll(() => actor.system.details.level !== before && actor.getFlag("acks-extras", "classes")?.levelUpRoll == null, { tries: 50 });
    await H.sleep(800);
    return {
      pressed: true,
      level: actor.system.details.level,
      storedMax: actor._source.system.hp.max,
      preparedMax: actor.system.hp.max,
      kept: actor.getFlag("acks-extras", "classes")?.levelUpRoll ?? null,
    };
  },
  /** Give the character the experience its class asks for the next level, so the wizard is ready again. */
  readyNext: async ({ actorId, classId }) => {
    const actor = game.actors.get(actorId);
    const next = game.items.get(classId).system.nextXp(actor.system.details.level);
    if (next != null) await actor.update({ "system.details.xp.value": next });
    return next != null && actor.system.details.xp.value >= next;
  },
  kept: async ({ actorId }) => game.actors.get(actorId).getFlag("acks-extras", "classes")?.levelUpRoll ?? null,
  setLevel: async ({ actorId, level }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.details.level": level });
    await new Promise((r) => setTimeout(r, 600));
    return { level: actor.system.details.level, kept: actor.getFlag("acks-extras", "classes")?.levelUpRoll ?? null };
  },
  setCon: async ({ actorId, con }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.scores.con.value": con });
    return actor.system.scores.con.mod;
  },
  addRaise: async ({ actorId, by }) => {
    const actor = game.actors.get(actorId);
    const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [
      { name: "QA Hardy Draught", changes: [{ key: "system.hp.max", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(by) }] },
    ]);
    return { uuid: effect?.uuid ?? null, stored: actor._source.system.hp.max, prepared: actor.system.hp.max };
  },
  setting: async ({ value }) => {
    const prior = game.settings.get("acks-extras", "levelUpHpMode");
    if (value != null) await game.settings.set("acks-extras", "levelUpHpMode", value);
    return { prior, now: game.settings.get("acks-extras", "levelUpHpMode") };
  },
  intPicks: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const model = CONFIG.Actor.dataModels.character;
    const picks = acksExtras.classes.intBonusPicks;
    const ladder = [];
    for (let s = 3; s <= 18; s++) ladder.push(picks(s));
    return {
      coreFunction: typeof model?.getAttributeModifier === "function",
      zeroAtLowest: ladder[0] === 0,
      neverNegative: ladder.every((n) => n >= 0),
      nonDecreasing: ladder.every((n, i) => i === 0 || n >= ladder[i - 1]),
      positiveAtTop: ladder.at(-1) > 0,
      matchesCore: ladder.every((n, i) => n === Math.max(0, Number(model.getAttributeModifier(i + 3)) || 0)),
      actorFigure: picks(0, actor) === Math.max(0, Number(actor.system.scores.int.mod) || 0),
    };
  },
  notes: async ({ text }) => {
    const H = globalThis.__cl;
    return { said: H.notes.some((n) => n.text === text) };
  },
  localize: async ({ key, data }) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),
  clearNotes: async () => { globalThis.__cl.notes.length = 0; globalThis.__cl.errors.length = 0; return true; },
  drain: async () => ({ errors: globalThis.__cl.errors.slice(), cards: globalThis.__cl.cards.slice() }),
  restore: async () => {
    const H = globalThis.__cl;
    if (!H?.patched) return "never installed";
    for (const k of Object.keys(H.orig)) ui.notifications[k] = H.orig[k];
    console.error = H.consoleError;
    Hooks.off("createChatMessage", H.hook);
    for (const app of foundry.applications.instances.values()) if (H.root(app)?.querySelector(".acks-extras-classes-levelup-body")) await app.close({ animate: false });
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.classes?.applyClass`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}
/** A CDP session on the seat's page, for the boot recorder and a real reload. */
async function cdp(port) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 600000;
    const on = (event) => {
      const reply = JSON.parse(event.data);
      if (reply.id === id) { ws.removeEventListener("message", on); resolve(reply.result); }
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => ws.close() };
}
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const s = await cdp(port);
  await s.send("Page.enable");
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER });
  await s.send("Page.reload");
  await sleep(1500);
  const seconds = await ready(api, label);
  s.close();
  return seconds;
}
/** A real reload of the seat's page: the page, its module state and its open windows all go. */
async function reload(port, label, api) {
  const s = await cdp(port);
  await s.send("Page.reload");
  s.close();
  await sleep(1500);
  return ready(api, label);
}

let gm = null;
let player = null;
let actorId = null;
let priorMode = null;
/** The uuids of what this run made: its climbs' cards and the effect it adds. The only documents teardown deletes. */
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
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
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
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  const cls = await gm.fixture("classes/levelup-roll-class", "Item", { name: "QA Climbing Class", type: `${MOD}.class`, system: { levels: ROWS, hitDie: "1d6" } });
  const gap = await gm.fixture("classes/levelup-roll-gap-class", "Item", { name: "QA Gap Class", type: `${MOD}.class`, system: { levels: GAP_ROWS, hitDie: "1d6" } });
  const nohd = await gm.fixture("classes/levelup-roll-nohd-class", "Item", { name: "QA Diceless Class", type: `${MOD}.class`, system: { levels: NOHD_ROWS } });
  const character = await gm.fixture("classes/levelup-roll-character", "Actor", {
    name: "QA Climber", type: "character", ownership: { default: 0, [playerId]: 3 }, system: { scores: { con: { value: CON.plain } } },
  });
  actorId = character.id;
  priorMode = (await run(gm, P.setting, { value: null })).prior;
  note("hit-point mode before the walk", priorMode);
  if (priorMode === "additive") await run(gm, P.setting, { value: "raw" });

  section("the wizard keeps its roll");
  let shaped = await run(gm, P.shape, { actorId, classId: cls.id, start: 2, con: CON.plain });
  check("shape: bound at 2nd with the next level's experience, no kept roll", shaped.applied && shaped.level === 2 && shaped.kept === null, shaped);
  const first = await run(player, P.openWizard, { actorId });
  check("the Player's Class tab offers Level up and it opens the wizard", first.button && first.dialog, { button: first.button, dialog: first.dialog });
  check("the wizard shows a roll and keeps it for 3rd, full mode, the dice of 3rd and the Constitution modifier", first.rolled && first.kept?.level === 3 && first.kept?.mode === "full" && first.kept?.hd === "3d6" && first.kept?.con === first.conMod, first.kept);
  await run(player, P.closeWizard);
  const second = await run(player, P.openWizard, { actorId });
  check("a closed and reopened wizard shows the same roll", second.dialog && second.line === first.line && JSON.stringify(second.kept) === JSON.stringify(first.kept), { sameLine: second.line === first.line });
  await run(player, P.closeWizard);
  note("player reloaded after (s)", await reload(PORTS.player, "player", player));
  await run(player, P.install);
  const third = await run(player, P.openWizard, { actorId });
  check("after a real page reload the wizard shows the same roll", third.dialog && third.line === first.line && JSON.stringify(third.kept) === JSON.stringify(first.kept), { sameLine: third.line === first.line });
  await run(player, P.closeWizard);
  const highMod = await run(gm, P.setCon, { actorId, con: CON.high });
  const fourth = await run(player, P.openWizard, { actorId });
  check("a different Constitution modifier is rolled again, stamped with the new one", fourth.dialog && fourth.kept?.con === highMod && fourth.kept?.con !== first.kept?.con, { stamped: fourth.kept?.con === highMod, differs: fourth.kept?.con !== first.kept?.con });
  await run(player, P.closeWizard);
  await run(gm, P.setCon, { actorId, con: CON.plain });
  const fifth = await run(player, P.openWizard, { actorId });
  await run(player, P.clearNotes);
  const climbed = await run(player, P.applyWizard, { actorId });
  check("Apply climbs to 3rd, writes the offered maximum as the stored one and clears the kept roll", climbed.pressed && climbed.level === 3 && climbed.storedMax === fifth.newMax && climbed.kept === null, { level: climbed.level, maxMatches: climbed.storedMax === fifth.newMax, cleared: climbed.kept === null });

  section("a level moved under the wizard clears the kept roll");
  const readyAgain = await run(gm, P.readyNext, { actorId, classId: cls.id });
  const atThird = await run(player, P.openWizard, { actorId });
  await run(player, P.closeWizard);
  check("given 4th's experience, the wizard at 3rd keeps a roll for 4th", readyAgain === true && atThird.kept?.level === 4, { ready: readyAgain, dialog: atThird.dialog, keptLevel: atThird.kept?.level ?? null });
  const lowered = await run(gm, P.setLevel, { actorId, level: 2 });
  check("a level typed back to 2nd clears it", lowered.level === 2 && lowered.kept === null, lowered);

  section("the old maximum is the stored one");
  shaped = await run(gm, P.shape, { actorId, classId: cls.id, start: 2, con: CON.plain });
  const raise = await run(gm, P.addRaise, { actorId, by: 5 });
  if (raise.uuid) { await gm.track(raise.uuid, "ActiveEffect"); own.push(raise.uuid); }
  check("an effect raises the prepared maximum above the stored one", raise.prepared === raise.stored + 5, { raised: raise.prepared === raise.stored + 5 });
  const raised = await run(player, P.openWizard, { actorId });
  check("the wizard's old maximum is the stored one, not the raised one", raised.dialog && raised.oldMax === raised.storedMax && raised.oldMax !== raised.preparedMax, { stored: raised.oldMax === raised.storedMax });
  const climbedRaised = await run(player, P.applyWizard, { actorId });
  check("the climb stores the offered maximum, and the effect still adds on top of it", climbedRaised.storedMax === raised.newMax && climbedRaised.preparedMax === raised.newMax + 5, { stored: climbedRaised.storedMax === raised.newMax, onTop: climbedRaised.preparedMax === raised.newMax + 5 });
  if (raise.uuid) note("effect swept", await gm.sweepTracked({ only: [raise.uuid] }));

  section("a class printing no hit dice");
  await run(gm, P.clearNotes);
  shaped = await run(gm, P.shape, { actorId, classId: nohd.id, start: 1, con: CON.plain, maxHp: 6 });
  const noHdWarn = await run(gm, P.localize, { key: "ACKS-CLASSES.apply.noHd", data: { name: "QA Diceless Class" } });
  check("binding it leaves the hit points standing and says no hit points were rolled", shaped.applied && shaped.storedMax === 6 && (await run(gm, P.notes, { text: noHdWarn })).said, { applied: shaped.applied, standing: shaped.storedMax === 6 });
  const diceless = await run(player, P.openWizard, { actorId });
  const noHdHint = await run(player, P.localize, { key: "ACKS-CLASSES.levelup.noHd" });
  check("the wizard rolls nothing, offers one point more and names the gap", diceless.dialog && !diceless.rolled && diceless.newMax === diceless.oldMax + 1 && diceless.hint === noHdHint && diceless.kept === null, { rolled: diceless.rolled, plusOne: diceless.newMax === diceless.oldMax + 1, hint: diceless.hint === noHdHint, kept: diceless.kept });
  await run(player, P.closeWizard);

  section("a level with no cell takes the dice its class's rows print");
  await run(gm, P.shape, { actorId, classId: gap.id, start: 1, con: CON.plain });
  const gapped = await run(player, P.openWizard, { actorId });
  check("the climb to 2nd of a class printing no 2nd-level cell rolls two dice of the size its last die row prints", gapped.dialog && gapped.rolled && gapped.kept?.hd === "2d6", gapped.kept?.hd);
  await run(player, P.closeWizard);

  section("additive mode");
  await run(gm, P.shape, { actorId, classId: cls.id, start: 2, con: CON.plain });
  const full = await run(player, P.openWizard, { actorId });
  await run(player, P.closeWizard);
  note("mode set", await run(gm, P.setting, { value: "additive" }));
  await sleep(800);
  const additive = await run(player, P.openWizard, { actorId });
  check("additive mode replaces the full-mode roll with one die of the next level's size", full.kept?.mode === "full" && additive.kept?.mode === "additive" && /^1d6/.test(additive.kept?.formula ?? ""), { full: full.kept?.mode, additive: additive.kept?.mode, oneDie: /^1d6/.test(additive.kept?.formula ?? "") });
  check("additive mode offers the old maximum plus the die and the modifier, at least one", additive.newMax === additive.oldMax + Math.max(1, (additive.kept?.total ?? 0) + additive.conMod), { adds: additive.newMax - additive.oldMax });
  await run(player, P.closeWizard);
  note("mode restored", await run(gm, P.setting, { value: priorMode === "additive" ? "additive" : priorMode }));
  priorMode = null;

  section("the Intellect bonus picks are the system's modifier");
  const picks = await run(player, P.intPicks, { actorId });
  check("the system serves the modifier, and the picks follow it: none at the lowest score, never negative, rising with the score", picks.coreFunction && picks.zeroAtLowest && picks.neverNegative && picks.nonDecreasing && picks.positiveAtTop && picks.matchesCore, picks);
  check("a character's picks are its own prepared modifier, clamped at zero", picks.actorFigure, picks.actorFigure);

  const drained = await run(player, P.drain);
  const gmDrained = await run(gm, P.drain);
  check("no console error on either seat over the walk", !drained.errors.length && !gmDrained.errors.length, { player: drained.errors.slice(0, 3), gm: gmDrained.errors.slice(0, 3) });
  for (const c of [...drained.cards, ...gmDrained.cards]) {
    if (c.actor !== actorId) continue;
    await gm.track(c.id, "ChatMessage");
    own.push(`ChatMessage.${c.id}`);
  }
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && priorMode != null) {
    try { note("mode restored", await run(gm, P.setting, { value: priorMode })); } catch (err) { console.error("mode restore:", err?.message ?? err); }
  }
  if (gm && actorId) {
    try { await run(gm, P.setCon, { actorId, con: CON.plain }); } catch (err) { console.error("con restore:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's own cards and effect go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: classes/levelup-roll-class, classes/levelup-roll-gap-class, classes/levelup-roll-nohd-class, classes/levelup-roll-character");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
