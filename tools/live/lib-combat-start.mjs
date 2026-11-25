/**
 * Live walk, lib-combat-start: a combat begun and abandoned at the declaration
 * prompt is left unstarted and its surprise is lifted (patches/combat-start.mjs).
 * Walks docs/lib/TESTING.md, "A cancelled declaration", steps 1 to 4: Cancel, the
 * window's X, Yes, and a start abandoned by a reload of the GM seat.
 * Machine values arrive through ./_env.mjs. Every name here is invented.
 *
 * The Surprise Matrix is driven as a Judge does: Begin Combat is
 * `combat.startCombat()`, the cell is clicked in the open matrix with both global
 * modifiers set far negative so every combatant is surprised whatever the die
 * shows, and the declaration confirm is answered through its own buttons.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the characters
 * `lib/surprise-pc-a` and `lib/surprise-pc-b`, the monster `lib/surprise-monster`
 * and the scene `lib/surprise-scene`, each actor with a linked token on the scene
 * (the walk writes the tokens' dispositions and links at its start, and clears
 * Surprised from the three actors before every step). The combats are a create
 * path, retired and built again each run by the run's own ledger:
 * `lib/combat-start-cancel` (steps 1 and 2), `lib/combat-start-yes` (step 3) and
 * `lib/combat-start-abandon` (step 4). Disposable, by the ledger: every chat card
 * this client posted while the walk ran (caught by a wrapper on the message class,
 * not by author or time). The GM seat's viewed scene is set to the walk's own and
 * put back.
 *
 * Step 4 reloads the GM seat while the confirm is open, through the treasure kit's
 * `record`, the walk's one real page lifecycle. It does not prove a second GM seat.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { record } from "./_treasure-kit.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const TAG = MACHINE.own ? ` ${MACHINE.own}` : "";
// A figure far enough below the die's range that every roll lands at or under the threshold.
const SURE = -20;

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
    isGM: game.user.isGM,
    canvas: !!globalThis.canvas,
    viewing: globalThis.canvas?.scene?.id ?? null,
    startCombat: typeof CONFIG.Combat.documentClass.prototype.startCombat === "function",
    internalStartCombat: typeof CONFIG.Combat.documentClass.prototype.internalStartCombat === "function",
  }),

  /** Wrap the message class's create so every card this client posts is recorded; the ids are read back at teardown. */
  arm: async () => {
    const H = (globalThis.__combatStart = globalThis.__combatStart ?? { cards: [], undo: [] });
    if (H.undo.length) return true;
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
    return true;
  },
  cards: async () => [...new Set(globalThis.__combatStart?.cards ?? [])].filter((id) => game.messages.has(id)),
  disarm: async () => {
    const H = globalThis.__combatStart;
    for (const undo of H?.undo ?? []) undo();
    if (H) { H.undo = []; H.cards = []; }
    return true;
  },

  /** View the walk's scene on this seat: the system's roll reads `canvas.scene`. */
  view: async ({ sceneId }) => {
    await game.scenes.get(sceneId)?.view();
    return globalThis.canvas?.scene?.id ?? null;
  },

  /**
   * The three actors each with a linked token on the scene at the disposition the matrix sorts by, and no Surprised
   * on any of them. Returns the token ids by actor id.
   */
  shape: async ({ sceneId, actors }) => {
    const scene = game.scenes.get(sceneId);
    const tokens = {};
    for (const [actorId, disposition] of Object.entries(actors)) {
      const actor = game.actors.get(actorId);
      let token = scene.tokens.find((t) => t.actorId === actorId);
      if (!token) {
        const td = await actor.getTokenDocument({ x: 200, y: 200 }, { parent: scene });
        [token] = await scene.createEmbeddedDocuments("Token", [td.toObject()]);
      }
      if (token.disposition !== disposition || token.actorLink !== true) await token.update({ disposition, actorLink: true });
      tokens[actorId] = token.id;
      const ids = actor.effects.filter((e) => e.statuses.has("surprised")).map((e) => e.id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    }
    return tokens;
  },

  /** The combat holds one combatant for each token and is the world's active one, so the system's roll reaches it. */
  seat: async ({ combatId, sceneId, tokens }) => {
    const combat = game.combats.get(combatId);
    await combat.createEmbeddedDocuments("Combatant", Object.entries(tokens).map(([actorId, tokenId]) => ({ tokenId, sceneId, actorId })));
    await combat.activate();
    return { combatants: combat.combatants.size, current: game.combat?.id === combatId };
  },

  /** Begin Combat, as the tracker's button does. */
  begin: async ({ combatId }) => {
    await game.combats.get(combatId).startCombat();
    return true;
  },

  /** The open matrix of this combat, once its cells have rendered. */
  matrix: async ({ combatId }) => {
    const app = [...foundry.applications.instances.values()].find((a) => a.options?.combat?.id === combatId && a.element?.querySelector("[data-action='rollSurprise']"));
    return { open: !!app, count: [...foundry.applications.instances.values()].filter((a) => a.options?.combat?.id === combatId).length };
  },

  /** Set both global modifiers and click the cell that rolls both sides. */
  click: async ({ combatId, mod }) => {
    const app = [...foundry.applications.instances.values()].find((a) => a.options?.combat?.id === combatId && a.element?.querySelector("[data-action='rollSurprise']"));
    if (!app) return { found: false };
    for (const name of ["friendlyGlobalMod", "hostileGlobalMod"]) {
      const input = app.element.querySelector(`input[name='${name}']`);
      if (input) input.value = String(mod);
    }
    const cell = app.element.querySelector("[data-action='rollSurprise'][data-adventurer-status='fore'][data-monster-status='fore']");
    if (!cell) return { found: true, cell: false };
    cell.click();
    return { found: true, cell: true };
  },

  /** The declaration confirm: the DialogV2 that offers a Yes and a No button. */
  confirm: async () => {
    const dialogs = [...foundry.applications.instances.values()].filter((a) => a instanceof foundry.applications.api.DialogV2 && a.element?.querySelector('button[data-action="yes"]') && a.element?.querySelector('button[data-action="no"]'));
    return { open: dialogs.length > 0, count: dialogs.length };
  },

  /** Answer the confirm: `yes`, `no` (Cancel), or `x` (the window's close control). */
  answer: async ({ how }) => {
    const app = [...foundry.applications.instances.values()].find((a) => a instanceof foundry.applications.api.DialogV2 && a.element?.querySelector('button[data-action="yes"]') && a.element?.querySelector('button[data-action="no"]'));
    if (!app) return { found: false };
    if (how === "x") {
      const control = app.element.querySelector('[data-action="close"]');
      if (control) control.click();
      else await app.close();
      return { found: true, via: control ? "x" : "close()" };
    }
    app.element.querySelector(`button[data-action="${how}"]`).click();
    return { found: true, via: how };
  },

  /** The combat as it stands: round, the started flag, and which combatants carry Surprised. */
  read: async ({ combatId }) => {
    const combat = game.combats.get(combatId);
    if (!combat) return { exists: false };
    return {
      exists: true,
      round: combat.round,
      initDone: combat.flags?.acks?.initDone ?? null,
      combatants: combat.combatants.size,
      surprised: [...combat.combatants].map((c) => !!c.actor?.statuses?.has("surprised")),
    };
  },

  /** Close every surprise matrix and declaration confirm still open, so the next step starts on a clean screen. */
  closeAll: async () => {
    for (const a of [...foundry.applications.instances.values()]) {
      const dialog = a instanceof foundry.applications.api.DialogV2 && a.element?.querySelector('button[data-action="yes"]') && a.element?.querySelector('button[data-action="no"]');
      if (dialog || a.options?.combat) await a.close();
    }
    return true;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

/** Read a page function until `test` passes, or give the last reading back. */
async function until(api, fn, arg, test, { tries = 20, every = 250 } = {}) {
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
let armed = false;

try {
  section("seats");
  open.gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  const gm = open.gm;
  const census = await run(gm, P.census);
  note("census", census);
  if (!census.isGM) blocked("the GM seat joined a user that is not a GM");
  if (!census.canvas) blocked("no canvas is on the page: no scene is drawn");
  check("the combat's start methods resolve on the combat class, the patch's wrap targets", census.startCombat && census.internalStartCombat, census);
  previousScene = census.viewing;
  await run(gm, P.arm);
  armed = true;

  section("fixtures");
  const pcA = await gm.fixture("lib/surprise-pc-a", "Actor", { name: `QA Surprise PC A${TAG}`, type: "character" });
  const pcB = await gm.fixture("lib/surprise-pc-b", "Actor", { name: `QA Surprise PC B${TAG}`, type: "character" });
  const monster = await gm.fixture("lib/surprise-monster", "Actor", { name: `QA Surprise monster${TAG}`, type: "monster", items: [] });
  const scene = await gm.fixture("lib/surprise-scene", "Scene", { name: `QA Surprise scene${TAG}`, width: 1200, height: 800, grid: { size: 100 } });
  const viewed = await until(gm, P.view, { sceneId: scene.id }, (v) => v === scene.id);
  check("this seat views the walk's scene, so the system's roll reads it", viewed === scene.id, viewed);
  // Characters friendly (1), the monster hostile (-1), as the matrix sorts its pools.
  const actors = { [pcA.id]: 1, [pcB.id]: 1, [monster.id]: -1 };
  const shapeOnce = async () => run(gm, P.shape, { sceneId: scene.id, actors });
  const tokens = await shapeOnce();
  check("each actor has a linked token on the scene", Object.keys(actors).every((id) => typeof tokens[id] === "string"), tokens);

  /** Retire the last run's combat of this marker, and build it again holding the three combatants. */
  const freshCombat = async (marker) => {
    await gm.retire(marker, "Combat");
    const combat = await gm.fixture(marker, "Combat", { scene: scene.id, active: false });
    const seated = await run(gm, P.seat, { combatId: combat.id, sceneId: scene.id, tokens });
    check(`${marker}: the combat holds the three combatants and is the world's active one`, seated.combatants === 3 && seated.current, seated);
    return combat;
  };

  /** Begin Combat, click the certain cell and wait for the declaration confirm. Returns the reading taken with it open. */
  const toConfirm = async (label, combat) => {
    await shapeOnce();
    await run(gm, P.begin, { combatId: combat.id });
    const m = await until(gm, P.matrix, { combatId: combat.id }, (v) => v.open);
    check(`${label}: Begin Combat opens one matrix`, m.open && m.count === 1, m);
    const clicked = await run(gm, P.click, { combatId: combat.id, mod: SURE });
    check(`${label}: the matrix's cell was found and clicked`, clicked.found && clicked.cell, clicked);
    const c = await until(gm, P.confirm, null, (v) => v.open, { tries: 60 });
    check(`${label}: the declaration confirm opens`, c.open && c.count === 1, c);
    const before = await until(gm, P.read, { combatId: combat.id }, (v) => v.initDone === true && v.surprised.every(Boolean));
    check(`${label}: with the confirm open the combat is at round 0 with initDone set and all three combatants Surprised`, before.round === 0 && before.initDone === true && before.surprised.length === 3 && before.surprised.every(Boolean), before);
    return before;
  };

  /** The combat left unstarted: round 0, no started flag, no Surprised on any combatant. */
  const unstarted = (s) => s.exists && s.round === 0 && s.initDone === null && s.surprised.length === 3 && s.surprised.every((x) => !x);

  section("1. Cancel");
  const cancel = await freshCombat("lib/combat-start-cancel");
  await toConfirm("step 1", cancel);
  note("answer", await run(gm, P.answer, { how: "no" }));
  const one = await until(gm, P.read, { combatId: cancel.id }, unstarted);
  check("step 1: after Cancel the combat is at round 0, initDone is unset and no combatant is Surprised", unstarted(one), one);
  await sleep(1000);
  const oneLater = await run(gm, P.read, { combatId: cancel.id });
  check("step 1: it stays so a second later", unstarted(oneLater), oneLater);

  section("2. The window's X");
  await toConfirm("step 2", cancel);
  note("answer", await run(gm, P.answer, { how: "x" }));
  const two = await until(gm, P.read, { combatId: cancel.id }, unstarted);
  check("step 2: after the X the combat is at round 0, initDone is unset and no combatant is Surprised", unstarted(two), two);

  section("3. Yes");
  const yes = await freshCombat("lib/combat-start-yes");
  await toConfirm("step 3", yes);
  note("answer", await run(gm, P.answer, { how: "yes" }));
  const three = await until(gm, P.read, { combatId: yes.id }, (v) => v.exists && v.round === 1, { tries: 60 });
  check("step 3: after Yes the combat is at round 1 with initDone set", three.round === 1 && three.initDone === true, three);
  await sleep(1000);
  const threeLater = await run(gm, P.read, { combatId: yes.id });
  check("step 3: the patch clears nothing: initDone is set and all three combatants are still Surprised", threeLater.round === 1 && threeLater.initDone === true && threeLater.surprised.every(Boolean), threeLater);

  section("4. A start abandoned by a reload");
  const abandon = await freshCombat("lib/combat-start-abandon");
  await toConfirm("step 4", abandon);
  // The page reload loses the card ledger; the ids are read first and tracked.
  for (const id of await run(gm, P.cards)) swept.push(gm.track(id, "ChatMessage"));
  note("gm ready after the reload (s)", await record(PORTS.gm, "gm", gm));
  armed = false;
  await sleep(2000);
  await run(gm, P.arm);
  armed = true;
  const stranded = await run(gm, P.read, { combatId: abandon.id });
  check("step 4: after the reload the abandoned start is stranded: round 0, initDone set, all three Surprised", stranded.round === 0 && stranded.initDone === true && stranded.surprised.every(Boolean), stranded);
  const noConfirm = await run(gm, P.confirm);
  check("step 4: no declaration confirm is open on the reloaded seat", !noConfirm.open, noConfirm);
  await run(gm, P.begin, { combatId: abandon.id });
  const cleaned = await until(gm, P.read, { combatId: abandon.id }, unstarted);
  check("step 4: Begin Combat unsets initDone and lifts Surprised before the new matrix is clicked", unstarted(cleaned), cleaned);
  const m4 = await until(gm, P.matrix, { combatId: abandon.id }, (v) => v.open);
  check("step 4: the new matrix is open, with no cell clicked", m4.open && m4.count === 1, m4);
  await run(gm, P.closeAll);

  walkDone();
} catch (err) {
  if (err?.name !== "WalkBlocked") {
    console.log(`WALK ERROR: ${err?.message ?? err}`);
    console.error(err?.stack ?? err);
  }
  process.exitCode = 1;
} finally {
  section("teardown");
  try {
    if (open.gm) {
      await run(open.gm, P.closeAll);
      for (const id of await run(open.gm, P.cards)) swept.push(open.gm.track(id, "ChatMessage"));
      if (armed) await run(open.gm, P.disarm);
      if (previousScene) await run(open.gm, P.view, { sceneId: previousScene });
    }
  } catch (err) { console.error("cards:", err?.message ?? err); }
  try { if (open.gm && swept.length) note("swept", await open.gm.sweepTracked({ only: swept })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log(`\nchecks: ${tally.pass} passed, ${tally.fail} failed`);
  if (tally.fail) process.exitCode = 1;
  for (const api of Object.values(open)) { try { api.close(); } catch (_e) { /* closed */ } }
}
