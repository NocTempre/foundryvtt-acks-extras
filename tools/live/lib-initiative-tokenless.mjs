/**
 * Live walk, a combat holding a combatant with no token: docs/lib/TESTING.md step 13
 * (T-0828; docs/lib/DECISIONS.md, "A combat holding a combatant with no token is
 * rolled whole by Foundry's own method"). A combat of one tokened combatant and one
 * with no token is begun by the tracker's own Begin Combat button on the GM seat, then
 * rolled through Roll All, Roll NPCs and each row's own roll (initiative blanked before
 * each press), then the group control is used with two tokens controlled (the tracker's `.create-group` element where drawn, else the system's `manageGroup` it calls).
 * Machine values arrive through ./_env.mjs. Every name and figure here is invented.
 *
 * Observed after each press: every row the press covers carries a number, the one
 * notice naming the tokenless row has shown once for the whole walk and never again,
 * `flags.acks.lock-turns` reads false, no new application window opened (no Surprise
 * Matrix, no declaration prompt), and the console recorded no error. After Begin:
 * `combat.started`, round 1, `flags.acks.initDone` true. After the group control: the
 * stored `flags.acks.groups` reads as it did.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the scene
 * `lib/initiative-tokenless-scene`, the monsters `lib/initiative-tokenless-a` (tokened)
 * and `lib/initiative-tokenless-b` (never given a token), and the token
 * `lib/initiative-tokenless-token`. The combat carries `lib/initiative-tokenless`; it
 * is retired at the start if a dead run left one and swept by id at the end, with every
 * chat card this client posted while the walk ran (caught by a wrapper on the message
 * class) and with the tracker viewing none, since core's `Combat#_onDelete` activates
 * the combat the deleting client views. The GM seat's viewed scene is set to the walk's
 * scene and put back.
 *
 * After the first combat's presses (the group control twice) the walk ends it, builds a
 * second tokenless combat in the same page with no reload and drives it the same way (the
 * notice shows once for each combat), then builds a combat of two tokened rows and rolls it
 * through Roll All with `flags.acks.initDone` set by hand, since a tokened Begin opens the
 * system's Surprise Matrix and declaration prompt. Every press asserts no console error,
 * no "did not chain" and no "Error detected in module" notification; the tokened combat
 * asserts exactly one initiative card for its two rolls. The three wraps are registered
 * MIXED, so none may be dropped by the first press that skips the system's method.
 *
 * Driven: the tracker's own buttons (Begin, Roll All, Roll NPCs, each row's roll). The group control, which is
 * not a `data-action` button, is described above; the walk prints how it was used. A press that leaves rows blank is followed by a direct `rollAll` call, printed with what it throws.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
const MARKER = "lib/initiative-tokenless";

const tally = { pass: 0, fail: 0 };
const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const check = (label, ok, detail) => {
  tally[ok ? "pass" : "fail"] += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* Page side: each function is stringified and run in the GM seat's page. */
const P = {
  census: async () => ({
    user: game.user.name,
    role: game.user.role,
    canvas: !!globalThis.canvas,
    viewing: globalThis.canvas?.scene?.id ?? null,
    notice: !!game.i18n.has?.("ACKS-LIB.initiative.tokenless") || game.i18n.localize("ACKS-LIB.initiative.tokenless") !== "ACKS-LIB.initiative.tokenless",
  }),

  /** Record every chat card this client posts, every warning notification and every console error, until `disarm`. */
  arm: async () => {
    const H = (globalThis.__tokenless = { cards: [], warns: [], errors: [], errNotes: [], undo: [] });
    const classes = new Set([CONFIG.ChatMessage.documentClass, globalThis.ChatMessage, foundry.documents.ChatMessage].filter(Boolean));
    for (const cls of classes) {
      const own = Object.hasOwn(cls, "create");
      const original = cls.create;
      cls.create = async function (...args) {
        const made = await original.apply(this, args);
        for (const m of [made].flat()) if (m?.id) H.cards.push(m.id);
        return made;
      };
      H.undo.push(() => { if (own) cls.create = original; else delete cls.create; });
    }
    const warn = ui.notifications.warn;
    ui.notifications.warn = function (message, ...rest) { H.warns.push(String(message)); return warn.call(this, message, ...rest); };
    H.undo.push(() => { ui.notifications.warn = warn; });
    const notifyError = ui.notifications.error;
    ui.notifications.error = function (message, ...rest) { H.errNotes.push(String(message?.message ?? message).slice(0, 300)); return notifyError.call(this, message, ...rest); };
    H.undo.push(() => { ui.notifications.error = notifyError; });
    const error = console.error;
    const trace = (a) => (a?.stack ? `${a.message} @ ${String(a.stack).split("\n").slice(1, 5).map((l) => l.trim().replace(/^at /, "")).join(" | ")}` : String(a?.message ?? a));
    console.error = function (...args) { H.errors.push(args.map(trace).join(" ").slice(0, 700)); return error.apply(this, args); };
    H.undo.push(() => { console.error = error; });
    const onError = (e) => H.errors.push(`window: ${trace(e?.error ?? e)}`.slice(0, 700));
    window.addEventListener("error", onError);
    H.undo.push(() => window.removeEventListener("error", onError));
    const onReject = (e) => H.errors.push(`unhandled rejection: ${trace(e?.reason)}`.slice(0, 700));
    window.addEventListener("unhandledrejection", onReject);
    H.undo.push(() => window.removeEventListener("unhandledrejection", onReject));
    return true;
  },
  cards: async () => [...new Set(globalThis.__tokenless?.cards ?? [])].filter((id) => game.messages.has(id)),
  disarm: async () => {
    const H = globalThis.__tokenless;
    for (const undo of H?.undo ?? []) undo();
    if (H) H.undo = [];
    return true;
  },

  view: async ({ sceneId }) => {
    await game.scenes.get(sceneId)?.view();
    return globalThis.canvas?.scene?.id ?? null;
  },

  /** The fixture token's actor and the scene, at the shape the step needs. */
  shape: async ({ sceneId, tokenId, a, b }) => {
    const scene = game.scenes.get(sceneId);
    const token = scene.tokens.get(tokenId);
    const strays = game.scenes.reduce((n, sc) => n + sc.tokens.filter((t) => t.actorId === b).length, 0);
    return { tokenActorIsA: token?.actorId === a, bTokens: strays };
  },

  /** An active combat on the scene, a tokened combatant and a tokenless one, viewed by the tracker and drawn. */
  combat: async ({ sceneId, tokenId, tokenId2 = null, a, b, tokened = false }) => {
    const combat = await Combat.create({ scene: sceneId, active: true });
    await combat.activate();
    await combat.createEmbeddedDocuments("Combatant", tokened ? [{ tokenId, sceneId, actorId: a }, { tokenId: tokenId2, sceneId, actorId: a }] : [{ tokenId, sceneId, actorId: a }, { actorId: b }]);
    ui.combat.viewed = combat;
    await ui.combat.render({ combat, force: true });
    for (let n = 0; n < 40 && ui.combat.element?.querySelectorAll?.("li.combatant").length < 2; n++) await new Promise((r) => setTimeout(r, 150));
    return { id: combat.id, uuid: combat.uuid, rows: ui.combat.element?.querySelectorAll?.("li.combatant").length ?? 0, viewed: ui.combat.viewed?.id === combat.id };
  },

  /** A combat ended by deleting it, the tracker viewing none (core's `Combat#_onDelete` activates the combat the client views). */
  endCombat: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    if (!combat) return { gone: true };
    ui.combat.viewed = null;
    await combat.delete();
    return { gone: !game.combats.has(combatId) };
  },

  /** The flag the system's Begin writes, set by hand where a tokened Begin would open its prompts. */
  initDone: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    await combat.setFlag("acks", "initDone", true);
    return combat.getFlag("acks", "initDone") === true;
  },

  /** The chat cards this client posted since `before`, and how many name every one of `names`. */
  cardInfo: async ({ before, names }) => {
    const now = [...new Set(globalThis.__tokenless?.cards ?? [])].filter((id) => game.messages.has(id) && !before.includes(id));
    const msgs = now.map((id) => game.messages.get(id));
    return { cards: msgs.length, namingAll: msgs.filter((m) => names.every((n) => String(m.content ?? "").includes(n))).length, rolls: msgs.map((m) => m.rolls?.length ?? 0) };
  },

  /** The application windows standing now, by id. */
  apps: async () => [...foundry.applications.instances.keys()],

  state: async ({ combatId, bName, appsBefore }) => {
    const combat = game.combats.get(combatId);
    const H = globalThis.__tokenless;
    const rows = [...combat.combatants].map((c) => ({ id: c.id, tokenless: !c.token, initiative: c.initiative ?? null }));
    return {
      started: combat.started === true,
      round: combat.round,
      lock: combat.getFlag("acks", "lock-turns") ?? null,
      initDone: combat.getFlag("acks", "initDone") ?? null,
      groups: JSON.stringify(combat.getFlag("acks", "groups") ?? null),
      rows,
      numbered: rows.every((r) => typeof r.initiative === "number"),
      noticeCount: H.warns.filter((w) => w.includes(bName)).length,
      warns: H.warns.length,
      newApps: [...foundry.applications.instances].filter(([id]) => !appsBefore.includes(id)).map(([, app]) => app.constructor.name),
      errors: [...H.errors],
      errNotes: [...H.errNotes],
    };
  },

  /** Initiative blanked on every row. */
  blank: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments("Combatant", [...combat.combatants].map((c) => ({ _id: c.id, initiative: null })));
    return [...combat.combatants].every((c) => c.initiative == null);
  },

  /** The system's `rollAll` called directly, for what it throws when a press left the rows blank. */
  diagRoll: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    try {
      await combat.rollAll();
      return { threw: null, numbered: [...combat.combatants].every((c) => typeof c.initiative === "number"), lock: combat.getFlag("acks", "lock-turns") ?? null };
    } catch (err) {
      return { threw: String(err?.message ?? err), stack: String(err?.stack ?? "").split("\n").slice(1, 6).map((l) => l.trim()).join(" | "), lock: combat.getFlag("acks", "lock-turns") ?? null };
    }
  },

  /** The group control: the tracker's own element where it is drawn, else the system's call it makes, with both tokens controlled. */
  group: async ({ tokenIds }) => {
    const tokens = tokenIds.map((id) => canvas.tokens.get(id)).filter(Boolean);
    tokens.forEach((t, i) => t.control({ releaseOthers: i === 0 }));
    const el = document.querySelector("#combat .create-group, .combat-tracker .create-group, .create-group");
    const before = canvas.tokens.controlled.length;
    if (el) { el.click(); return { via: "the tracker's .create-group element", controlled: before }; }
    game.combat.manageGroup(canvas.tokens.controlled);
    return { via: "the system's manageGroup, called on the controlled tokens (no .create-group element is drawn)", controlled: before };
  },

  /** Press a button in the tracker: by selector, or the first control whose action name matches `like`. */
  press: async ({ selector = null, like = null, tokenId = null }) => {
    const root = ui.combat?.element;
    const all = [...(root?.querySelectorAll?.("[data-action]") ?? [])];
    const el = selector ? root?.querySelector?.(selector) : all.find((b) => new RegExp(like, "i").test(b.dataset.action));
    if (!el) return { pressed: false, actions: [...new Set(all.map((b) => b.dataset.action))] };
    if (tokenId) canvas.tokens.get(tokenId)?.control({ releaseOthers: true });
    el.click();
    return { pressed: true, action: el.dataset.action };
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Read a page function until `test` passes, or give the last reading back. */
async function until(api, fn, arg, test, { tries = 60, every = 250 } = {}) {
  let value;
  for (let n = 0; n < tries; n++) {
    value = await run(api, fn, arg);
    if (test(value)) return value;
    await sleep(every);
  }
  return value;
}

const open = {};
const swept = [];
let previousScene = null;

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("seat", { user: census.user, role: census.role });
  if (!census.canvas) blocked("the canvas is not on the page: no scene is drawn on this seat");
  check("the seat is a GM", census.role >= 3, census.role);
  check("the notice's lang key resolves", census.notice === true, census.notice);
  previousScene = census.viewing;

  section("fixtures");
  for (const marker of [MARKER, `${MARKER}-2`, `${MARKER}-3`]) {
    try { note(`retired a dead run's combat (${marker})`, await gm.retire(marker, "Combat")); } catch (err) { note("retire", String(err?.message ?? err)); }
  }
  const scene = await gm.fixture("lib/initiative-tokenless-scene", "Scene", { name: `QA Tokenless scene${TAG}`, width: 1200, height: 800, grid: { size: 100 } });
  const monA = await gm.fixture("lib/initiative-tokenless-a", "Actor", { name: `QA Tokenless A${TAG}`, type: "monster", items: [] });
  const monB = await gm.fixture("lib/initiative-tokenless-b", "Actor", { name: `QA Tokenless B${TAG}`, type: "monster", items: [] });
  const token = await gm.fixture("lib/initiative-tokenless-token", "Token", { name: monA.name, actorId: monA.id, actorLink: true, x: 200, y: 200 }, { parent: scene.uuid });
  const token2 = await gm.fixture("lib/initiative-tokenless-token-2", "Token", { name: monA.name, actorId: monA.id, actorLink: true, x: 500, y: 200 }, { parent: scene.uuid });
  const shape = await run(gm, P.shape, { sceneId: scene.id, tokenId: token.id, a: monA.id, b: monB.id });
  check("the kept token is the first monster's and no token of the second stands on any scene", shape.tokenActorIsA && shape.bTokens === 0, shape);
  const viewed = await until(gm, P.view, { sceneId: scene.id }, (v) => v === scene.id, { tries: 20 });
  check("this seat views the walk's scene", viewed === scene.id, viewed);
  await run(gm, P.arm);

  /** One tokenless combat's presses, in the order of the recipe: Begin, Roll All, Roll NPCs, each row's roll, the group control twice. `base` is the notices naming the tokenless row shown before this combat. */
  const drive = async (tag, made, { base = 0 } = {}) => {
    const appsBefore = await run(gm, P.apps);
    const arg = { combatId: made.id, bName: monB.name, appsBefore };
    const state = () => run(gm, P.state, arg);
    const settled = (test, tries = 80) => until(gm, P.state, arg, test, { tries });
    let s = await state();
    check(`${tag}: the combat holds one tokenless combatant and one with a token, neither rolled`, s.rows.length === 2 && s.rows.filter((r) => r.tokenless).length === 1 && s.rows.every((r) => r.initiative === null) && !s.started, s.rows);
    const noticeAfter = (label, st) => {
      check(`${tag} ${label}: the one notice shows once for the combat, no new window opened, no console error`, st.noticeCount === base + 1 && !st.newApps.length && !st.errors.length, { notices: st.noticeCount - base, newApps: st.newApps, errors: st.errors });
      check(`${tag} ${label}: no "did not chain" error and no "Error detected in module" notification`, !st.errors.some((e) => /did not chain/i.test(e)) && !st.errNotes.some((e) => /Error detected in module|did not chain/i.test(e)), { errNotes: st.errNotes });
    };

    section(`${tag}: Begin Combat`);
    const begin = await run(gm, P.press, { selector: '[data-action="startCombat"]' });
    check(`${tag}: the tracker's Begin Combat button is there and pressed`, begin.pressed, begin);
    s = await settled((st) => st.started && st.numbered && st.noticeCount >= base + 1);
    check(`${tag}: the combat is started at round 1 and every row carries a number`, s.started && s.round === 1 && s.numbered, { started: s.started, round: s.round, rows: s.rows });
    check(`${tag}: flags.acks.initDone is true and flags.acks.lock-turns is false`, s.initDone === true && s.lock !== true, { initDone: s.initDone, lock: s.lock });
    await sleep(1500);
    s = await state();
    noticeAfter("Begin", s);

    section(`${tag}: the rolls`);
    const roll = async (label, press) => {
      check(`${tag} ${label}: initiative blanked on every row`, await run(gm, P.blank, { combatId: made.id }));
      const pressed = await press();
      check(`${tag} ${label}: the button is there and pressed`, pressed.pressed, pressed);
      const st = await settled((x) => x.numbered, 40);
      check(`${tag} ${label}: every row the press covers carries a number`, st.numbered, st.rows);
      if (!st.numbered) note(`${tag} ${label}: the system's rollAll called directly`, await run(gm, P.diagRoll, { combatId: made.id }));
      await sleep(1000);
      const after = await state();
      check(`${tag} ${label}: flags.acks.lock-turns reads false`, after.lock !== true, after.lock);
      noticeAfter(label, after);
    };
    await roll("Roll All", () => run(gm, P.press, { selector: '[data-action="rollAll"]' }));
    await roll("Roll NPCs", () => run(gm, P.press, { selector: '[data-action="rollNPC"]' }));
    for (const [i, row] of s.rows.entries()) {
      await roll(`the roll on row ${i + 1}${row.tokenless ? " (the tokenless one)" : ""}`, async () => {
        const first = await run(gm, P.press, { selector: `li.combatant[data-combatant-id="${row.id}"] [data-action="rollInitiative"]` });
        return first.pressed ? first : run(gm, P.press, { selector: `li.combatant[data-combatant-id="${row.id}"] [data-action*="roll" i]` });
      });
    }

    section(`${tag}: the group control, pressed twice`);
    const before = (await state()).groups;
    for (const press of ["first", "second"]) {
      const group = await run(gm, P.group, { tokenIds: [token.id, token2.id] });
      note(`${tag} the group control, ${press} press`, group);
      check(`${tag} ${press} press: two tokens are controlled when the group control is used`, group.controlled === 2, group);
      await sleep(2000);
      s = await state();
      check(`${tag} ${press} press: no group is stored, flags.acks.groups reads as it did`, s.groups === before, { before, after: s.groups });
      noticeAfter(`group control, ${press} press`, s);
      check(`${tag} ${press} press: both rows still carry a number and flags.acks.lock-turns reads false`, s.numbered && s.lock !== true, { rows: s.rows, lock: s.lock });
    }
  };

  section("the combat");
  const made = await run(gm, P.combat, { sceneId: scene.id, tokenId: token.id, a: monA.id, b: monB.id });
  swept.push(gm.track(made.uuid, "Combat"));
  await gm.mark(made.uuid, MARKER);
  check("the tracker shows the combat's two rows", made.rows === 2 && made.viewed, made);
  await drive("first combat", made, { base: 0 });

  section("a second tokenless combat in the same page, no reload");
  await gm.eval("(() => { ui.combat.viewed = null; return true; })()");
  note("the first combat ended (deleted, with the tracker viewing none)", await run(gm, P.endCombat, { combatId: made.id }));
  const made2 = await run(gm, P.combat, { sceneId: scene.id, tokenId: token.id, a: monA.id, b: monB.id });
  swept.push(gm.track(made2.uuid, "Combat"));
  await gm.mark(made2.uuid, `${MARKER}-2`);
  check("the tracker shows the second combat's two rows", made2.rows === 2 && made2.viewed, made2);
  await drive("second combat", made2, { base: 1 });

  section("a tokened combat begun after a tokenless one posts its one initiative card");
  await gm.eval("(() => { ui.combat.viewed = null; return true; })()");
  note("the second combat ended", await run(gm, P.endCombat, { combatId: made2.id }));
  const made3 = await run(gm, P.combat, { sceneId: scene.id, tokenId: token.id, tokenId2: token2.id, a: monA.id, b: monB.id, tokened: true });
  swept.push(gm.track(made3.uuid, "Combat"));
  await gm.mark(made3.uuid, `${MARKER}-3`);
  check("the tracker shows the tokened combat's two rows, none tokenless", made3.rows === 2 && made3.viewed, made3);
  // Begin Combat on a tokened combat opens the system's Surprise Matrix and declaration prompt, which need a seat's answers; the walk sets the flag Begin would have written and rolls through the tracker.
  note("initDone set as Begin would have", await run(gm, P.initDone, { combatId: made3.id }));
  const arg3 = { combatId: made3.id, bName: monB.name, appsBefore: await run(gm, P.apps) };
  const cardsBefore = await run(gm, P.cards);
  const pressed3 = await run(gm, P.press, { selector: '[data-action="rollAll"]' });
  check("Roll All on the tokened combat is there and pressed", pressed3.pressed, pressed3);
  const s3 = await until(gm, P.state, arg3, (st) => st.numbered, { tries: 60 });
  await sleep(1500);
  const info = await run(gm, P.cardInfo, { before: cardsBefore, names: [monA.name] });
  check("the tokened combat's rows both carry a number and flags.acks.lock-turns reads false", s3.numbered && s3.lock !== true, { rows: s3.rows, lock: s3.lock });
  check("exactly one initiative card was posted for the tokened combat's two rolls (not one per combatant)", info.cards === 1, info);
  const f3 = await run(gm, P.state, arg3);
  check("the tokened combat's presses recorded no console error, no \"did not chain\" and no \"Error detected in module\" notification", !f3.errors.length && !f3.errNotes.length, { errors: f3.errors, errNotes: f3.errNotes });

  walkDone();
} catch (err) {
  console.log(`WALK ERROR: ${err?.message ?? err}`);
  console.error(err?.stack ?? err);
  process.exitCode = 1;
} finally {
  section("teardown");
  try {
    if (open.gm) {
      await open.gm.eval("(() => { ui.combat.viewed = null; return true; })()");
      for (const id of await run(open.gm, P.cards)) swept.push(open.gm.track(id, "ChatMessage"));
      await run(open.gm, P.disarm);
      if (previousScene) await run(open.gm, P.view, { sceneId: previousScene });
    }
  } catch (err) { console.error("cards:", err?.message ?? err); }
  try { if (open.gm && swept.length) note("swept", await open.gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
