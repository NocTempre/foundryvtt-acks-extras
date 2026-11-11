/**
 * Live walk, classes-hp-record: the per-level hit point record and the
 * character sheet's Stats tab reading it. Walks docs/classes/TESTING.md "The
 * wizard's kept roll", step 12, on the GM and Player seats: the class picker's
 * bind, the level-up wizard's Apply and the sheet's Hit dice roll each leave
 * their steps; the maximum's tooltip and the line under it render from a real
 * sheet; a hand edit of the maximum, a character with no record, a level
 * lowered by hand and an effect on the maximum each read as the record says;
 * the sheet's Hit dice roll applies Constitution with a class and without and
 * never calls the system's own roll; and a character above 10th level keeps
 * the line inside its column at the sheet's default width. Machine values
 * arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker: two classes with INVENTED level rows
 * (`classes/hp-record-class`, four levels; `classes/hp-record-long-class`,
 * twelve) and five characters the Player seat owns
 * (`classes/hp-record-character`, `classes/hp-record-high-character`,
 * `classes/hp-record-blank-character`, and `classes/hp-record-con-character`
 * and `classes/hp-record-con-classless-character` with a Constitution
 * modifier above zero), each brought to a known shape at its step's start.
 * The run's own documents — the cards its climb and reroll post and the
 * effect it adds — are tracked and swept by uuid. No setting is changed; the
 * dice rig and the watch on the system's roll come off in teardown. Every
 * figure printed is a boolean or a count.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { origin } = MACHINE;
const { browser } = MACHINE;
const MOD = "acks-extras";

/** Invented rows: no class prints these, and nothing here is read off a page. */
const ROWS = [1, 2, 3, 4].map((level) => ({ level, xp: (level - 1) * 1000, title: "", hd: `${level}d6` }));
/** Twelve invented rows: a die a level to 9th, then a flat rise. */
const LONG_ROWS = Array.from({ length: 12 }, (_, i) => {
  const level = i + 1;
  return { level, xp: i * 1000, title: "", hd: `${Math.min(level, 9)}d6${level > 9 ? `+${(level - 9) * 2}` : ""}` };
});
const CON = 10;
/** A score whose modifier, from the system's own table, is above zero: the roll's Constitution part shows. */
const TOUGH_CON = 18;
const HIGH_LEVEL = 11;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** Records a page's throws from before its first script: the only way to see init, setup and ready. */
const RECORDER = `(() => {
  const R = (globalThis.__hrBoot = { phase: "load", phases: [], errors: [] });
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
    const H = (globalThis.__hr = globalThis.__hr ?? {});
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
    H.sheetCls = () => Object.values(CONFIG.Actor.sheetClasses.character).find((e) => e.cls?.name === "AcksCharacterSheet")?.cls;
    H.sheetOf = (actor) => [...foundry.applications.instances.values()].find((a) => a.document === actor && a.constructor === H.sheetCls());
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
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
      boot: globalThis.__hrBoot ?? null,
    };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** Bring a character to `level` on `classId` (null: no class), no effects, no classes flag; bind it with a rebuild where a class is given. */
  shape: async ({ actorId, classId, level, con, maxHp = null }) => {
    const actor = game.actors.get(actorId);
    const MOD = "acks-extras";
    if (actor.effects.size) await actor.deleteEmbeddedDocuments("ActiveEffect", actor.effects.map((e) => e.id));
    await actor.update({ [`flags.${MOD}.classes`]: new foundry.data.operators.ForcedDeletion() });
    await actor.update({ "system.details.level": 1, "system.details.xp.value": 0, "system.scores.con.value": con, ...(maxHp != null ? { "system.hp.max": maxHp, "system.hp.value": maxHp } : {}) });
    let applied = null;
    if (classId) applied = await acksExtras.classes.applyClass(actor, game.items.get(classId), { level, confirm: false, rebuildVitals: true });
    return { applied: applied ? !!applied.applied : null, level: actor.system.details.level, hasRecord: Array.isArray(actor.getFlag(MOD, "classes")?.hpRolls) };
  },
  /** The record and the figures it is read against. */
  read: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const rolls = actor.getFlag("acks-extras", "classes")?.hpRolls;
    return {
      level: actor.system.details.level,
      stored: actor._source.system.hp.max,
      prepared: actor.system.hp.max,
      rolls: Array.isArray(rolls) ? rolls.map((s) => ({ ...s, hasFloor: Object.hasOwn(s, "floor") })) : null,
      dieMinimum: acksExtras.classes?.firstLevelDieMinimum?.() ?? null,
    };
  },
  /**
   * The class picker as the sheet's graduation cap opens it, on the class bound, with the level field set
   * to `level` the way a typed value submits it, then Apply pressed.
   */
  pickerApply: async ({ actorId, classId, level }) => {
    const H = globalThis.__hr;
    const actor = game.actors.get(actorId);
    for (const app of foundry.applications.instances.values()) if (H.root(app)?.classList?.contains("acks-extras-classes-assign")) await app.close({ animate: false });
    await acksExtras.classes.openClassPicker(actor);
    const app = await H.poll(() => [...foundry.applications.instances.values()].find((a) => a.id === `acks-classes-assign-${actorId}` && H.root(a)));
    if (!app) return { opened: false };
    const onClass = app.binding.classUuid === game.items.get(classId)?.uuid;
    const field = H.root(app).querySelector('input[name="acks-level"]');
    if (field && Number(field.value) !== level) {
      field.value = String(level);
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await H.poll(() => app.binding.level === level, { tries: 30 });
      await H.sleep(400);
    }
    H.root(app).querySelector('footer button[type="submit"]')?.click();
    await H.poll(() => !foundry.applications.instances.has(app.id), { tries: 60 });
    await H.sleep(800);
    return { opened: true, onClass, level: actor.system.details.level };
  },
  /** Give the character its next level's experience. */
  readyNext: async ({ actorId, classId }) => {
    const actor = game.actors.get(actorId);
    const next = game.items.get(classId).system.nextXp(actor.system.details.level);
    if (next != null) await actor.update({ "system.details.xp.value": next });
    return next != null && actor.system.details.xp.value >= next;
  },
  /** The Class tab's Level up, clicked; the kept roll read once the wizard shows; Apply pressed. */
  climb: async ({ actorId }) => {
    const H = globalThis.__hr;
    const actor = game.actors.get(actorId);
    let sheet = H.sheetOf(actor);
    if (!sheet) sheet = new (H.sheetCls())({ document: actor });
    sheet.tabGroups.primary = "class";
    await sheet.render({ force: true });
    await H.sleep(600);
    const button = H.root(sheet)?.querySelector('[data-action="levelUp"]');
    if (!button) return { button: false };
    button.click();
    const dialog = await H.poll(() => [...foundry.applications.instances.values()].find((a) => H.root(a)?.querySelector(".acks-extras-classes-levelup-body")));
    if (!dialog) return { button: true, dialog: false };
    const kept = actor.getFlag("acks-extras", "classes")?.levelUpRoll ?? null;
    const before = actor.system.details.level;
    H.root(dialog).querySelector('button[data-action="ok"]')?.click();
    // The level lands first (its own write clears the kept roll); the hit point
    // write, record step included, follows the grants. Wait for that step.
    await H.poll(() => actor.system.details.level !== before && (actor.getFlag("acks-extras", "classes")?.hpRolls ?? []).some((s) => s.level === before + 1), { tries: 75 });
    await H.sleep(800);
    return { button: true, dialog: true, keptFaces: kept?.faces ?? null, level: actor.system.details.level };
  },
  /**
   * The Stats tab as rendered for this seat: the maximum's tooltip, the line under the field, what core's
   * tooltip manager shows for the field, the same text assembled by the module's own function, and the
   * line's and its row's overflow. `fresh` closes any open sheet first, so the window opens at its
   * default size.
   */
  stats: async ({ actorId, fresh = false }) => {
    const H = globalThis.__hr;
    const actor = game.actors.get(actorId);
    let sheet = H.sheetOf(actor);
    if (fresh && sheet) { await sheet.close({ animate: false }); sheet = null; await H.sleep(300); }
    if (!sheet) sheet = new (H.sheetCls())({ document: actor });
    sheet.tabGroups.primary = "stats";
    await sheet.render({ force: true });
    await H.sleep(900);
    const root = H.root(sheet);
    const input = root?.querySelector('input[name="system.hp.max"]');
    const line = root?.querySelector(".acks-extras-classes-hp-record");
    let hover = null;
    if (input && game.tooltip?.activate) {
      game.tooltip.activate(input);
      await H.sleep(150);
      hover = game.tooltip.tooltip?.textContent ?? null;
      game.tooltip.deactivate();
    }
    const hp = await import("/modules/acks-extras/scripts/classes/hitpoints.mjs");
    const expected = hp.hitPointAuditText(actor);
    const fits = (el) => (el ? el.scrollWidth <= el.clientWidth : null);
    const col = line?.closest(".acks-extras-frame__col") ?? null;
    return {
      rendered: !!input,
      tip: input?.dataset.tooltipText ?? null,
      line: line?.textContent.trim() ?? null,
      lineTip: line?.dataset.tooltipText ?? null,
      hover,
      expected,
      lineFits: fits(line),
      rowFits: fits(line?.parentElement ?? null),
      colFits: fits(col),
      contentFits: fits(root?.querySelector(".window-content") ?? null),
      lineVisible: !!line && line.getBoundingClientRect().width > 0,
      width: Math.round(root?.getBoundingClientRect().width ?? 0),
      defaultWidth: sheet.constructor.DEFAULT_OPTIONS?.position?.width ?? null,
    };
  },
  /** Type a figure into the maximum on the rendered Stats tab, as a user would. */
  typeMax: async ({ actorId, max }) => {
    const H = globalThis.__hr;
    const actor = game.actors.get(actorId);
    const input = H.root(H.sheetOf(actor))?.querySelector('input[name="system.hp.max"]');
    if (!input) return { typed: false };
    input.value = String(max);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await H.poll(() => actor._source.system.hp.max === max, { tries: 40 });
    await H.sleep(700);
    return { typed: true, stored: actor._source.system.hp.max === max };
  },
  /** The dice beside Hit dice on the Stats tab, clicked and confirmed. */
  reroll: async ({ actorId }) => {
    const H = globalThis.__hr;
    const actor = game.actors.get(actorId);
    const button = H.root(H.sheetOf(actor))?.querySelector('[data-action="rollHitDice"]');
    if (!button) return { button: false };
    const before = new Set(foundry.applications.instances.keys());
    const stamp = JSON.stringify(actor.getFlag("acks-extras", "classes")?.hpRolls ?? null);
    button.click();
    const dialog = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !before.has(a.id) && H.root(a)?.querySelector('button[data-action="yes"]')));
    if (!dialog) return { button: true, dialog: false };
    H.root(dialog).querySelector('button[data-action="yes"]').click();
    const changed = await H.poll(() => JSON.stringify(actor.getFlag("acks-extras", "classes")?.hpRolls ?? null) !== stamp, { tries: 50 });
    await H.sleep(800);
    return { button: true, dialog: true, changed: !!changed };
  },
  setLevel: async ({ actorId, level }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.details.level": level });
    await new Promise((r) => setTimeout(r, 700));
    return actor.system.details.level;
  },
  addRaise: async ({ actorId, by }) => {
    const actor = game.actors.get(actorId);
    const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [
      { name: "QA Record Draught", changes: [{ key: "system.hp.max", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(by) }] },
    ]);
    await new Promise((r) => setTimeout(r, 500));
    return { uuid: effect?.uuid ?? null, raised: actor.system.hp.max === actor._source.system.hp.max + by };
  },
  /** Rig every die this client rolls to one end, and probe one roll; `unrig` puts the generator back. */
  rig: async ({ value }) => {
    const H = globalThis.__hr;
    if (!H.uniform) H.uniform = CONFIG.Dice.randomUniform;
    CONFIG.Dice.randomUniform = () => value;
    return (await new Roll("1d6").evaluate()).total;
  },
  unrig: async () => {
    const H = globalThis.__hr;
    if (!H?.uniform) return "untouched";
    CONFIG.Dice.randomUniform = H.uniform;
    H.uniform = null;
    return "restored";
  },
  /** Count calls to the system's own roll on these characters; `unspy` takes the counter off again. */
  spy: async ({ actorIds }) => {
    const H = globalThis.__hr;
    H.rollHPCalls = 0;
    H.spied = actorIds;
    for (const id of actorIds) {
      const actor = game.actors.get(id);
      const proto = Object.getPrototypeOf(actor).rollHP;
      actor.rollHP = function (...args) { H.rollHPCalls++; return proto.apply(this, args); };
    }
    return actorIds.every((id) => Object.hasOwn(game.actors.get(id), "rollHP"));
  },
  unspy: async () => {
    const H = globalThis.__hr;
    if (!H?.spied) return "untouched";
    for (const id of H.spied) { const actor = game.actors.get(id); if (actor && Object.hasOwn(actor, "rollHP")) delete actor.rollHP; }
    H.spied = null;
    return "restored";
  },
  spied: async () => globalThis.__hr.rollHPCalls ?? null,
  /** Whether the actor's latest card from this seat carries the text given (a localized part of the record). */
  cardCarries: async ({ actorId, text }) => {
    const H = globalThis.__hr;
    const last = H.cards.filter((c) => c.actor === actorId).at(-1);
    const content = last ? game.messages.get(last.id)?.content ?? "" : "";
    return { card: !!last, carries: !!text && content.includes(text) };
  },
  /**
   * The sheet's dice pressed and confirmed on a formula the module cannot read: the warnings shown, whether
   * the hit points or the record moved, how many cards the actor posted, and the module's own reason to compare.
   */
  refusal: async ({ actorId, formula }) => {
    const H = globalThis.__hr;
    const actor = game.actors.get(actorId);
    const levelup = await import("/modules/acks-extras/scripts/classes/levelup.mjs");
    const snap = () => JSON.stringify([actor._source.system.hp, actor.getFlag("acks-extras", "classes")?.hpRolls ?? null]);
    const before = snap();
    const cardsBefore = H.cards.filter((c) => c.actor === actorId).length;
    const warned = [];
    const warn = ui.notifications.warn;
    ui.notifications.warn = function (message, ...rest) { warned.push(String(message)); return warn.call(this, message, ...rest); };
    try {
      const button = H.root(H.sheetOf(actor))?.querySelector('[data-action="rollHitDice"]');
      if (!button) return { button: false };
      const open = new Set(foundry.applications.instances.keys());
      button.click();
      const dialog = await H.poll(() => [...foundry.applications.instances.values()].find((a) => !open.has(a.id) && H.root(a)?.querySelector('button[data-action="yes"]')));
      if (!dialog) return { button: true, dialog: false };
      H.root(dialog).querySelector('button[data-action="yes"]').click();
      await H.poll(() => warned.length > 0, { tries: 25 });
      await H.sleep(1200);
    } finally {
      ui.notifications.warn = warn;
    }
    const reason = await levelup.rerollRefusal(actor);
    return {
      button: true,
      dialog: true,
      warnedReason: warned.includes(reason),
      unchanged: snap() === before,
      cards: H.cards.filter((c) => c.actor === actorId).length - cardsBefore,
      namesFormula: reason.includes(formula),
      localized: !reason.includes("ACKS-CLASSES."),
    };
  },
  set: async ({ actorId, data }) => {
    const actor = game.actors.get(actorId);
    await actor.update(data);
    return { level: actor.system.details.level, hd: actor.system.hp.hd, con: actor.system.scores.con.mod, bound: !!actor.getFlag("acks-extras", "classes")?.uuid };
  },
  localize: async ({ key, data }) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),
  drain: async () => ({ errors: globalThis.__hr.errors.slice(), cards: globalThis.__hr.cards.slice() }),
  restore: async () => {
    const H = globalThis.__hr;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    Hooks.off("createChatMessage", H.hook);
    for (const app of [...foundry.applications.instances.values()]) if (app.constructor === H.sheetCls() && app.document?.getFlag?.("world", "fixture")?.startsWith("classes/hp-record")) await app.close({ animate: false });
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
/** The recorder has to be in the page before it loads, so it goes in over the seat's own CDP target. */
async function record(port, label, api) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(origin));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++next + 700000;
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

/** A step's comparable shape, its stamp left out. */
const bare = (s) => JSON.stringify({ ...s, at: undefined });

let gm = null;
let player = null;
/** The uuids of what this run made: its cards and its effect. The only documents teardown deletes. */
const own = [];
const actorIds = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 520_000);
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
  const cls = await gm.fixture("classes/hp-record-class", "Item", { name: "QA Record Class", type: `${MOD}.class`, system: { levels: ROWS, hitDie: "1d6" } });
  const long = await gm.fixture("classes/hp-record-long-class", "Item", { name: "QA Long Record Class", type: `${MOD}.class`, system: { levels: LONG_ROWS, hitDie: "1d6" } });
  const owned = { default: 0, [playerId]: 3 };
  const hero = await gm.fixture("classes/hp-record-character", "Actor", { name: "QA Recorded", type: "character", ownership: owned, system: { scores: { con: { value: CON } } } });
  const high = await gm.fixture("classes/hp-record-high-character", "Actor", { name: "QA Veteran Recorded", type: "character", ownership: owned, system: { scores: { con: { value: CON } } } });
  const blank = await gm.fixture("classes/hp-record-blank-character", "Actor", { name: "QA Unrecorded", type: "character", ownership: owned, system: { scores: { con: { value: CON } } } });
  const tough = await gm.fixture("classes/hp-record-con-character", "Actor", { name: "QA Tough Recorded", type: "character", ownership: owned, system: { scores: { con: { value: TOUGH_CON } } } });
  const toughBare = await gm.fixture("classes/hp-record-con-classless-character", "Actor", { name: "QA Tough Classless", type: "character", ownership: owned, system: { scores: { con: { value: TOUGH_CON } } } });
  actorIds.push(hero.id, high.id, blank.id, tough.id, toughBare.id);
  const fmt =(key, data) => run(player, P.localize, { key: `ACKS-CLASSES.hpAudit.${key}`, data });

  section("the class picker's bind records each level it rolls");
  const shaped = await run(gm, P.shape, { actorId: hero.id, classId: cls.id, level: 1, con: CON });
  check("shape: bound at 1st, a record written by the rebuild", shaped.applied && shaped.level === 1 && shaped.hasRecord, shaped);
  const picked = await run(player, P.pickerApply, { actorId: hero.id, classId: cls.id, level: 2 });
  let r = await run(gm, P.read, { actorId: hero.id });
  const rolls2 = r.rolls ?? [];
  const firstFloorOk = rolls2[0]?.hasFloor && (rolls2[0].floor === null || (Number.isInteger(rolls2[0].floor) && rolls2[0].floor > 0));
  check("the Player's picker at 2nd leaves one step per level, the last holding the stored maximum", picked.opened && picked.onClass && picked.level === 2 && rolls2.length === 2 && rolls2.map((s) => s.level).join() === "1,2" && rolls2[1].max === r.stored, { opened: picked.opened, level: picked.level, steps: rolls2.length, lastIsStored: rolls2[1]?.max === r.stored });
  check("each step carries its formula, faces, Constitution part and kind; the floor only on the 1st", rolls2.every((s) => s.kind === "roll" && /^\dd6$/.test(s.formula ?? "") && Array.isArray(s.faces) && Number.isInteger(s.con) && Number.isFinite(s.at)) && firstFloorOk && !rolls2[1]?.hasFloor, { firstFloor: firstFloorOk, floorImported: rolls2[0]?.floor != null, laterFloor: !!rolls2[1]?.hasFloor });
  check("the 1st step's floor matches what the world has imported", (rolls2[0]?.floor ?? 1) === r.dieMinimum, { matches: (rolls2[0]?.floor ?? 1) === r.dieMinimum });

  section("the Stats tab reads it");
  let view = await run(player, P.stats, { actorId: hero.id, fresh: true });
  const head = await fmt("head", { max: r.stored });
  const shorts = [];
  for (const s of rolls2) shorts.push(await fmt("short", { level: s.level, faces: s.faces.join(", "), max: s.max }));
  const floorPart = rolls2[0].floor == null ? await fmt("floorNone") : await fmt("floor", { floor: rolls2[0].floor });
  check("the maximum's data-tooltip-text is the module's assembled record", view.rendered && view.tip === view.expected.tip && view.expected.state === "recorded", { rendered: view.rendered, same: view.tip === view.expected.tip, state: view.expected.state });
  check("the tooltip opens on the maximum and cites the page, naming each level's dice and the floor part", view.tip?.startsWith(head) && /RR ch\. 1/.test(view.tip) && rolls2.every((s) => view.tip.includes(s.formula)) && view.tip.includes(floorPart), { head: !!view.tip?.startsWith(head), cite: /RR ch\. 1/.test(view.tip ?? ""), floor: view.tip?.includes(floorPart) });
  check("core's tooltip manager shows that text for the field", view.hover === view.tip, { same: view.hover === view.tip });
  check("the line under the field lists each level's faces and maximum, and carries the same tooltip", view.lineVisible && view.line === view.expected.line && shorts.every((s) => view.line.includes(s)) && view.lineTip === view.tip, { visible: view.lineVisible, same: view.line === view.expected.line, levels: shorts.every((s) => view.line.includes(s)) });

  section("the wizard's Apply adds its level's step");
  await run(gm, P.readyNext, { actorId: hero.id, classId: cls.id });
  const climbed = await run(player, P.climb, { actorId: hero.id });
  r = await run(gm, P.read, { actorId: hero.id });
  const rolls3 = r.rolls ?? [];
  check("a third step whose faces are the wizard's kept roll and whose maximum is the applied one", climbed.dialog && climbed.level === 3 && rolls3.length === 3 && rolls3[2].level === 3 && JSON.stringify(rolls3[2].faces) === JSON.stringify(climbed.keptFaces) && rolls3[2].max === r.stored, { dialog: climbed.dialog, level: climbed.level, steps: rolls3.length, faces: JSON.stringify(rolls3[2]?.faces) === JSON.stringify(climbed.keptFaces), stored: rolls3[2]?.max === r.stored });
  check("the earlier steps are untouched", rolls3.slice(0, 2).every((s, i) => JSON.stringify(s) === JSON.stringify(rolls2[i])), { untouched: rolls3.slice(0, 2).every((s, i) => JSON.stringify(s) === JSON.stringify(rolls2[i])) });

  section("a maximum typed by hand");
  view = await run(player, P.stats, { actorId: hero.id });
  const handMax = r.stored + 7;
  const typed = await run(player, P.typeMax, { actorId: hero.id, max: handMax });
  r = await run(gm, P.read, { actorId: hero.id });
  view = await run(player, P.stats, { actorId: hero.id });
  const differs = await fmt("differs", { recorded: rolls3[2]?.max, stored: handMax });
  check("typing the maximum on the Stats tab writes no step", typed.typed && typed.stored && (r.rolls ?? []).length === 3 && (r.rolls ?? []).every((s, i) => JSON.stringify(s) === JSON.stringify(rolls3[i])), { typed: typed.typed && typed.stored, steps: (r.rolls ?? []).length });
  check("the tooltip and the line give the stored and recorded figures side by side", view.expected.state === "differs" && view.tip?.includes(differs) && view.line?.includes(differs), { state: view.expected.state, tip: view.tip?.includes(differs), line: view.line?.includes(differs) });

  section("a level lowered by hand trims the record");
  const lowered = await run(gm, P.setLevel, { actorId: hero.id, level: 2 });
  r = await run(gm, P.read, { actorId: hero.id });
  check("typed back to 2nd, the record holds levels 1 and 2 only, as they were", lowered === 2 && (r.rolls ?? []).map((s) => s.level).join() === "1,2" && (r.rolls ?? []).every((s, i) => bare(s) === bare(rolls2[i])), { level: lowered, steps: (r.rolls ?? []).length });

  section("the sheet's Hit dice roll replaces the record");
  view = await run(player, P.stats, { actorId: hero.id });
  const rerolled = await run(player, P.reroll, { actorId: hero.id });
  r = await run(gm, P.read, { actorId: hero.id });
  const rollsR = r.rolls ?? [];
  check("the dice beside Hit dice, confirmed, leave one step per level with the new maximum last", rerolled.dialog && rerolled.changed && rollsR.length === 2 && rollsR.map((s) => s.level).join() === "1,2" && rollsR[1].max === r.stored && rollsR.every((s) => s.at > rolls2[0].at), { dialog: rerolled.dialog, changed: rerolled.changed, steps: rollsR.length, lastIsStored: rollsR[1]?.max === r.stored });
  view = await run(player, P.stats, { actorId: hero.id });
  check("the Stats tab reads the rerolled record as recorded", view.expected.state === "recorded" && view.tip === view.expected.tip && view.line === view.expected.line, { state: view.expected.state });

  section("an effect on the maximum");
  const raise = await run(gm, P.addRaise, { actorId: hero.id, by: 5 });
  if (raise.uuid) { await gm.track(raise.uuid, "ActiveEffect"); own.push(raise.uuid); }
  await sleep(600);
  view = await run(player, P.stats, { actorId: hero.id });
  r = await run(gm, P.read, { actorId: hero.id });
  const inForce = await fmt("inForce", { value: r.prepared });
  check("the tooltip ends with the figure in force, and the record still matches the stored maximum", raise.raised && view.tip?.endsWith(inForce) && view.expected.state === "recorded", { raised: raise.raised, endsInForce: view.tip?.endsWith(inForce), state: view.expected.state });
  if (raise.uuid) note("effect swept", await gm.sweepTracked({ only: [raise.uuid] }));
  own.splice(own.indexOf(raise.uuid), 1);

  section("a character with no record");
  await run(gm, P.shape, { actorId: blank.id, classId: null, level: 1, con: CON, maxHp: 7 });
  view = await run(player, P.stats, { actorId: blank.id, fresh: true });
  const lineNone = await fmt("lineNone");
  const noneTip = `${await fmt("head", { max: 7 })} · ${await fmt("none")}`;
  check("the line says no roll is recorded and the tooltip invents no step", view.rendered && view.expected.state === "none" && view.line === lineNone && view.tip === noneTip, { state: view.expected.state, line: view.line === lineNone, tip: view.tip === noneTip });

  section("the sheet's Hit dice roll applies Constitution, with a class and without");
  // Every die a 1, so the written figure is the dice count times one-plus-Constitution, plus any floor and flat.
  const perStep = (s) => (s.faces ?? []).reduce((sum, f, i) => sum + Math.max(1, (i === 0 && s.floor != null ? Math.max(f, s.floor) : f) + s.con), 0) + (s.flat ?? 0);
  // Pressed on the GM seat: the Player seat's press is the section above.
  await run(gm, P.shape, { actorId: tough.id, classId: cls.id, level: 2, con: TOUGH_CON });
  await run(gm, P.shape, { actorId: toughBare.id, classId: null, level: 1, con: TOUGH_CON });
  // An upper-case formula the module reads as one cell of dice, on a character with no class.
  const bareShape = await run(gm, P.set, { actorId: toughBare.id, data: { "system.details.level": 2, "system.details.class": "", "system.hp.hd": "2D6" } });
  const conPart = await fmt("conPerDie", { con: `${bareShape.con >= 0 ? "+" : ""}${bareShape.con}` });
  const conRoll = async (actorId) => {
    await run(gm, P.stats, { actorId, fresh: true });
    const rerolledCon = await run(gm, P.reroll, { actorId });
    const read = await run(gm, P.read, { actorId });
    const card = await run(gm, P.cardCarries, { actorId, text: conPart });
    return { rerolledCon, read, card };
  };
  const spiedOn = await run(gm, P.spy, { actorIds: [tough.id, toughBare.id] });
  const lowProbe = await run(gm, P.rig, { value: 0.975 });
  let classed;
  let classless;
  try {
    classed = await conRoll(tough.id);
    classless = await conRoll(toughBare.id);
  } finally {
    await run(gm, P.unrig);
  }
  // A formula of two dice terms, through the real button: a warning naming it, nothing written, no card.
  const twoTerms = "1d6+1d4";
  await run(gm, P.set, { actorId: toughBare.id, data: { "system.hp.hd": twoTerms } });
  await run(gm, P.stats, { actorId: toughBare.id });
  const refusal = await run(gm, P.refusal, { actorId: toughBare.id, formula: twoTerms });
  const systemRolls = await run(gm, P.spied);
  await run(gm, P.unspy);
  const conMod = bareShape.con;
  const conOk = ({ read: rd }) => (rd.rolls ?? []).length > 0 && rd.rolls.every((s) => s.con === conMod && (s.faces ?? []).every((f) => f === 1) && s.total === perStep(s)) && rd.rolls.at(-1).max === rd.stored;
  check("the fixtures: a Constitution modifier above zero, the dice rigged to 1, the system's roll watched on both", conMod > 0 && lowProbe === 1 && spiedOn && !bareShape.bound && bareShape.level === 2, { conAboveZero: conMod > 0, low: lowProbe === 1, spied: spiedOn, classless: !bareShape.bound });
  check("with a class: each level's step carries the modifier, and its total is the dice with it applied", classed.rerolledCon.changed && classed.read.rolls?.length === 2 && conOk(classed), { changed: classed.rerolledCon.changed, steps: classed.read.rolls?.length ?? 0, applied: conOk(classed) });
  check("without a class: the character's own formula rolls with the modifier on each die", classless.rerolledCon.changed && classless.read.rolls?.length === 1 && classless.read.rolls[0].whole === true && classless.read.rolls[0].faces?.length === 2 && conOk(classless), { changed: classless.rerolledCon.changed, steps: classless.read.rolls?.length ?? 0, whole: classless.read.rolls?.[0]?.whole === true, applied: conOk(classless) });
  check("each roll's card carries the Constitution part from the record's own text", classed.card.card && classed.card.carries && classless.card.card && classless.card.carries, { classed: classed.card, classless: classless.card });
  check("an unreadable formula, through the sheet's dice: a warning with the module's reason naming the formula, nothing written, no card", refusal.dialog && refusal.warnedReason && refusal.namesFormula && refusal.localized && refusal.unchanged && refusal.cards === 0, { dialog: refusal.dialog, warned: refusal.warnedReason, named: refusal.namesFormula, localized: refusal.localized, unchanged: refusal.unchanged, cards: refusal.cards });
  check("the system's own roll, which applies no Constitution, was never called", systemRolls === 0, { calls: systemRolls });

  section("past the last die level every climb is a roll");
  // The long class's dice stop rising at 9th; 11th prints the same pool and a larger flat.
  const POOL = 9;
  const FLAT_AT_HIGH = 4;
  const climbPast = async (shapeEnd, climbEnd) => {
    const shapeProbe = await run(gm, P.rig, { value: shapeEnd });
    const highShaped = await run(gm, P.shape, { actorId: high.id, classId: long.id, level: HIGH_LEVEL - 1, con: CON });
    await run(gm, P.unrig);
    await run(gm, P.readyNext, { actorId: high.id, classId: long.id });
    const before = await run(gm, P.read, { actorId: high.id });
    const climbProbe = await run(player, P.rig, { value: climbEnd });
    const climbedHigh = await run(player, P.climb, { actorId: high.id });
    await run(player, P.unrig);
    const after = await run(gm, P.read, { actorId: high.id });
    const step = (after.rolls ?? []).find((s) => s.level === HIGH_LEVEL) ?? null;
    const perDie = (step?.faces ?? []).reduce((sum, f) => sum + Math.max(1, f + (step?.con ?? 0)), 0);
    return {
      shapeProbe,
      climbProbe,
      shaped: highShaped.applied && before.level === HIGH_LEVEL - 1,
      climbed: climbedHigh.dialog && after.level === HIGH_LEVEL,
      step,
      previous: before.stored,
      stored: after.stored,
      totalIsPool: !!step && step.total === perDie + FLAT_AT_HIGH && step.flat === FLAT_AT_HIGH,
      better: !!step && step.max === Math.max(step.total, before.stored + 1) && step.max === after.stored,
    };
  };
  // Shaped on low dice and climbed on high ones: the roll beats one over the last.
  const rollWins = await climbPast(0.975, 0.025);
  check("the dice rig on both seats (a 1 and a 6 probed)", rollWins.shapeProbe === 1 && rollWins.climbProbe === 6, { shape: rollWins.shapeProbe === 1, climb: rollWins.climbProbe === 6 });
  check(`a climb to ${HIGH_LEVEL}th, past the last die level, records a roll of the whole pool`, rollWins.shaped && rollWins.climbed && rollWins.step?.kind === "roll" && rollWins.step?.faces?.length === POOL && rollWins.totalIsPool, { shaped: rollWins.shaped, climbed: rollWins.climbed, kind: rollWins.step?.kind ?? null, faces: rollWins.step?.faces?.length ?? 0, pool: rollWins.totalIsPool });
  check("the roll beat one over the last, so it is the new maximum and no prior is named", rollWins.better && rollWins.step?.total > rollWins.previous + 1 && !Object.hasOwn(rollWins.step ?? {}, "prior"), { better: rollWins.better, rollWon: (rollWins.step?.total ?? 0) > rollWins.previous + 1 });
  // Shaped on high dice and climbed on low ones: one over the last beats the roll.
  const priorWins = await climbPast(0.025, 0.975);
  check("the dice rig again the other way (a 6 and a 1 probed)", priorWins.shapeProbe === 6 && priorWins.climbProbe === 1, { shape: priorWins.shapeProbe === 6, climb: priorWins.climbProbe === 1 });
  check(`the second climb to ${HIGH_LEVEL}th is a roll of the whole pool too`, priorWins.shaped && priorWins.climbed && priorWins.step?.kind === "roll" && priorWins.step?.faces?.length === POOL && priorWins.totalIsPool, { kind: priorWins.step?.kind ?? null, faces: priorWins.step?.faces?.length ?? 0, pool: priorWins.totalIsPool });
  check("one over the last beat the roll: the maximum is the previous plus one, which the step names as its prior", priorWins.better && priorWins.step?.max === priorWins.previous + 1 && priorWins.step?.total < priorWins.previous + 1 && priorWins.step?.prior === priorWins.previous, { better: priorWins.better, priorNamed: priorWins.step?.prior === priorWins.previous });

  section("a character above 10th level, at the sheet's default width");
  r = await run(gm, P.read, { actorId: high.id });
  view = await run(player, P.stats, { actorId: high.id, fresh: true });
  check(`at ${HIGH_LEVEL}th with a step per level`, r.level === HIGH_LEVEL && (r.rolls ?? []).length === HIGH_LEVEL && view.expected.state === "recorded", { steps: (r.rolls ?? []).length, state: view.expected.state });
  check("the sheet opened at its default width", view.defaultWidth != null && Math.abs(view.width - view.defaultWidth) <= 2, { atDefault: view.defaultWidth != null && Math.abs(view.width - view.defaultWidth) <= 2 });
  check("the line, its row and its column do not overflow", view.lineVisible && view.lineFits === true && view.rowFits === true && view.colFits === true, { line: view.lineFits, row: view.rowFits, col: view.colFits, content: view.contentFits });

  const drained = await run(player, P.drain);
  const gmDrained = await run(gm, P.drain);
  check("no console error on either seat over the walk", !drained.errors.length && !gmDrained.errors.length, { player: drained.errors.length, gm: gmDrained.errors.length });
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  // The cards this run's fixtures posted are tracked here, so a walk that dies part-way still sweeps them.
  const tracked = new Set();
  for (const seat of [player, gm]) {
    let cards = [];
    try { if (seat) cards = (await run(seat, P.drain)).cards; } catch (err) { console.error("drain:", err?.message ?? err); }
    for (const c of cards) {
      if (!actorIds.includes(c.actor) || tracked.has(c.id)) continue;
      tracked.add(c.id);
      try { await gm.track(c.id, "ChatMessage"); own.push(`ChatMessage.${c.id}`); } catch (err) { console.error("track:", err?.message ?? err); }
    }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`dice (${label})`, await run(seat, P.unrig)); } catch (err) { console.error(`unrig ${label}:`, err?.message ?? err); }
    try { if (seat) note(`system roll watch (${label})`, await run(seat, P.unspy)); } catch (err) { console.error(`unspy ${label}:`, err?.message ?? err); }
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's own cards and effect go.
  try { if (gm && own.length) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: classes/hp-record-class, classes/hp-record-long-class, classes/hp-record-character, classes/hp-record-high-character, classes/hp-record-blank-character, classes/hp-record-con-character, classes/hp-record-con-classless-character");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
