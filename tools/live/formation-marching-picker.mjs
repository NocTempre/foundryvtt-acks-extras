/**
 * Live walk, the saved marching order picker: docs/formation/TESTING.md,
 * "Saved marching orders, from the picker", steps 1-6, on the GM seat. The
 * picker is opened by the party token's HUD button and by the party sheet's
 * Load order pill, and each of its answers is driven as a click. Machine values
 * arrive through ./_env.mjs; nothing here names a port, a world, a seat or a
 * book.
 *
 * Fixtures, found by marker or built carrying one and kept:
 * `formation/picker-scene`, `formation/picker-party`, `formation/picker-van`,
 * `formation/picker-rear`. Writes outside the ledger: the saved orders this
 * run makes in the world setting, named for the run and deleted in the
 * `finally` by the ids their saves returned. The setting is shared, so the
 * picker's select is set to one of the run's own ids before any button is
 * pressed, and a press is withheld where the option is not there.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone, blocked } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const SCOPE = "acks-extras";
const RUN = Date.now().toString(36);

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const tally = { pass: 0, fail: 0 };
const check = (label, ok, detail) => {
  if (ok) tally.pass += 1; else tally.fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + JSON.stringify(detail)}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */

const P = {
  census: async () => ({ role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf, module: game.modules.get("acks-extras")?.version ?? null }),

  install: async () => {
    const H = (globalThis.__mp = globalThis.__mp ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 50, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.model = await import("/modules/acks-extras/scripts/formation/formation-model.mjs");
    H.orders = acksExtras.formation.marchingOrders;
    H.ids = (fid) => H.model.getFormation(fid).members.filter((m) => m?.actorId).map((m) => m.actorId);
    // The picker's select, told from any other dialog's by the picker's own field name and classes.
    H.select = () => [...document.querySelectorAll("select[name='id']")].find((s) => s.closest(".acks-extras-scroll")) ?? null;
    if (!H.notes) {
      H.notes = [];
      const info = ui.notifications.info;
      ui.notifications.info = function (msg, ...rest) {
        H.notes.push(String(msg));
        return info.call(this, msg, ...rest);
      };
    }
    return { ok: typeof H.orders?.save === "function" };
  },

  /** The record behind the party actor, once its create hook has made one. */
  formationOf: async ({ partyId }) => {
    const H = globalThis.__mp;
    const found = await H.poll(() => Object.values(H.model.getFormations()).find((f) => f.actorId === partyId), { tries: 60, every: 200 });
    return found ? { fid: found.id } : { error: "no formation for the party actor" };
  },

  /** Both members in the party, no fight on it, its token on the scene, and the scene in view. */
  startShape: async ({ fid, sceneId, members }) => {
    const H = globalThis.__mp;
    const scene = game.scenes.get(sceneId);
    await H.model.patchFormation(fid, (rec) => void (rec.combat = null));
    for (const [i, id] of members.entries()) {
      if (H.ids(fid).includes(id)) continue;
      const doc = await game.actors.get(id).getTokenDocument({ x: 300 + i * 200, y: 300 });
      const [made] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
      await H.model.addMember(H.model.getFormation(fid), game.actors.get(id), made);
    }
    await H.poll(() => H.model.getPartyToken(H.model.getFormation(fid)), { tries: 40, every: 150 });
    if (canvas.scene?.id !== sceneId) await scene.view();
    await H.poll(() => canvas.ready && canvas.scene?.id === sceneId, { tries: 200, every: 100 });
    const f = H.model.getFormation(fid);
    return { members: H.ids(fid), partyToken: !!H.model.getPartyToken(f), sceneId: f.sceneId, viewed: canvas.scene?.id === sceneId };
  },

  save: async ({ fid, name }) => {
    const H = globalThis.__mp;
    const saved = await H.orders.save(H.model.getFormation(fid), name);
    return { id: saved?.template?.id ?? null, cells: (saved?.template?.cells ?? []).map((c) => c.actorId ?? null) };
  },

  /** The party stood out of the saved order, so a form-up shows in who stands where. */
  disorder: async ({ fid, saved }) => {
    const H = globalThis.__mp;
    if (JSON.stringify(H.ids(fid)) === JSON.stringify(saved)) await H.model.patchFormation(fid, (rec) => void rec.members.reverse());
    await H.sleep(300);
    H.notes.length = 0;
    return H.ids(fid);
  },

  state: async ({ fid }) => {
    const H = globalThis.__mp;
    return { members: H.ids(fid), orders: H.orders.list().map((t) => t.id), notes: [...H.notes], picker: !!H.select() };
  },

  /** A press of the party token's HUD button, and the picker it opens. */
  hud: async ({ partyId }) => {
    const H = globalThis.__mp;
    const placeable = await H.poll(() => canvas.tokens.placeables.find((t) => t.document.actorId === partyId));
    if (!placeable) return { token: false };
    try { canvas.tokens.activate(); } catch (_e) { /* active */ }
    placeable.control({ releaseOthers: true });
    await H.sleep(300);
    await canvas.hud.token.bind(placeable);
    const button = await H.poll(() => document.querySelector("#token-hud .acks-formation-hud"), { tries: 30, every: 100 });
    const tip = button?.dataset.tooltip ?? null;
    button?.click();
    const select = await H.poll(() => H.select(), { tries: 40, every: 100 });
    try { await canvas.hud.token.close(); } catch (_e) { /* closed */ }
    try { canvas.tokens.releaseAll(); } catch (_e) { /* released */ }
    return { token: true, button: !!button, tip, picker: !!select, options: select?.options.length ?? 0 };
  },

  /** A press of the party sheet's Load order pill, and the picker it opens. */
  pill: async ({ partyId }) => {
    const H = globalThis.__mp;
    const app = game.actors.get(partyId).sheet;
    await app.render(true);
    const root = () => (app.element?.nodeType === 1 ? app.element : null);
    await H.poll(() => root()?.querySelector('[data-action="tab"][data-tab="order"]'), { tries: 40, every: 150 });
    root()?.querySelector('[data-action="tab"][data-tab="order"]')?.click();
    const control = await H.poll(() => root()?.querySelector('[data-action="loadMarchingOrder"]'), { tries: 30, every: 100 });
    control?.click();
    const select = await H.poll(() => H.select(), { tries: 40, every: 100 });
    return { rendered: !!root(), pill: !!control, picker: !!select, options: select?.options.length ?? 0 };
  },

  closeSheet: async ({ partyId }) => {
    try { await game.actors.get(partyId).sheet.close({ animate: false }); } catch (_e) { /* closed */ }
    return true;
  },

  /**
   * An answer to the open picker: the select set to one of the run's orders
   * and a button pressed, or the window closed with `action` null. No button
   * is pressed where the select does not take the id.
   */
  answer: async ({ id, action }) => {
    const H = globalThis.__mp;
    const select = H.select();
    if (!select) return { picker: false };
    const app = [...foundry.applications.instances.values()].find((a) => a.element?.nodeType === 1 && a.element.contains(select));
    if (action === null) {
      await app?.close({ animate: false });
    } else {
      select.value = id;
      if (select.value !== id) return { picker: true, chose: select.value, pressed: false };
      const button = (app?.element ?? select.closest("dialog"))?.querySelector(`button[data-action="${action}"]`);
      if (!button) return { picker: true, chose: select.value, pressed: false };
      button.click();
    }
    const gone = await H.poll(() => !H.select(), { tries: 40, every: 100 });
    await H.sleep(1500);
    return { picker: true, chose: action === null ? null : id, pressed: action !== null, gone: !!gone };
  },

  /** The run's own orders that still stand, forgotten by the ids their saves returned. */
  forget: async ({ ids }) => {
    const H = globalThis.__mp;
    const out = {};
    for (const id of ids) out[id] = await H.orders.delete(id);
    return out;
  },
};

const run = (api, fn, arg) => api.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);

async function ready(api, seconds = 240) {
  const t0 = Date.now();
  for (;;) {
    const ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.formation`).catch(() => false);
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`gm: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

const character = (name) => ({ name, type: "character", prototypeToken: { actorLink: true }, system: { hp: { value: 6, max: 6 } } });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let gm = null;
const mine = [];
try {
  section("seats");
  gm = await connect({ browser: MACHINE.browser, origin: MACHINE.origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm));
  // The party actor's formation is adopted by the primary GM's window.
  const primary = await run(gm, async () => {
    const util = await import("/modules/acks-extras/scripts/lib/util.mjs");
    return await Promise.race([util.primaryGMSettled(), new Promise((r) => setTimeout(() => r(null), 30000))]);
  });
  const census = await run(gm, P.census);
  note("census", { ...census, primary });
  check("the GM seat is the active GM and this window runs its automation", census.activeGMIsSelf && census.role === 4 && primary === true, { ...census, primary });
  if (primary !== true) blocked("this window is not the primary GM");
  note("installed", await run(gm, P.install));

  section("fixtures");
  const scene = await gm.fixture("formation/picker-scene", "Scene", { name: "Picker Walk", width: 1200, height: 800, grid: { size: 100 } });
  const party = await gm.fixture("formation/picker-party", "Actor", { name: "QA Picker Party", type: `${SCOPE}.party` });
  const van = await gm.fixture("formation/picker-van", "Actor", character("QA Picker Van"));
  const rear = await gm.fixture("formation/picker-rear", "Actor", character("QA Picker Rear"));
  const { fid, error } = await run(gm, P.formationOf, { partyId: party.id });
  if (error) throw new Error(error);
  const shape = await run(gm, P.startShape, { fid, sceneId: scene.id, members: [van.id, rear.id] });
  note("start shape", shape);
  check("the walk starts with both members in the party and its token on the viewed scene", shape.members.length === 2 && shape.partyToken && shape.sceneId === scene.id && shape.viewed, shape);

  // Three orders of the run's own: one is deleted in step 1, and two must stand
  // through step 5 for the HUD to open its picker in a world holding no other.
  const kept = await run(gm, P.save, { fid, name: `picker-${RUN}-kept` });
  const held = await run(gm, P.save, { fid, name: `picker-${RUN}-held` });
  const spare = await run(gm, P.save, { fid, name: `picker-${RUN}-spare` });
  mine.push(kept.id, held.id, spare.id);
  check("the run's three orders are saved", new Set(mine.filter(Boolean)).size === 3 && kept.cells.length === 2);
  const state = () => run(gm, P.state, { fid });
  const others = (await state()).orders.filter((id) => !mine.includes(id));
  note("orders of other runs in the world", others.length);

  section("1. the HUD's picker, Delete");
  let stood = await run(gm, P.disorder, { fid, saved: kept.cells });
  let opened = await run(gm, P.hud, { partyId: party.id });
  note("HUD", opened);
  check("the party token's button opens the picker, with every saved order in it", opened.button && opened.picker && opened.options === others.length + 3, opened);
  let answered = await run(gm, P.answer, { id: spare.id, action: "delete" });
  let now = await state();
  note("after Delete", { answered, notes: now.notes.length });
  check("Delete was pressed on the run's own order and the picker closed", answered.pressed && answered.chose === spare.id && answered.gone, answered);
  check("the order is gone and every other order stands", !now.orders.includes(spare.id) && now.orders.includes(kept.id) && now.orders.includes(held.id) && others.every((id) => now.orders.includes(id)));
  check("the party stands as it stood", same(now.members, stood), { stood, now: now.members });
  check("one notice, naming the deleted order", now.notes.length === 1 && now.notes[0].includes(`picker-${RUN}-spare`), now.notes.length);

  section("2. the HUD's picker, Form up");
  stood = await run(gm, P.disorder, { fid, saved: kept.cells });
  check("the party stands out of its saved order at the step's start", !same(stood, kept.cells));
  opened = await run(gm, P.hud, { partyId: party.id });
  answered = await run(gm, P.answer, { id: kept.id, action: "apply" });
  now = await state();
  check("Form up was pressed on the run's own order", opened.picker && answered.pressed && answered.gone, { opened, answered });
  check("the party stands in the saved order", same(now.members, kept.cells), now.members);
  check("the order is kept, and a notice says what the form-up did", now.orders.includes(kept.id) && now.notes.length === 1, now.notes.length);

  section("3. the HUD's picker, dismissed");
  stood = await run(gm, P.disorder, { fid, saved: kept.cells });
  opened = await run(gm, P.hud, { partyId: party.id });
  answered = await run(gm, P.answer, { id: null, action: null });
  now = await state();
  check("the picker opened and was closed with no button", opened.picker && answered.gone, { opened, answered });
  check("nobody moved, the order is kept and nothing is said", same(now.members, stood) && now.orders.includes(kept.id) && now.notes.length === 0, now);

  section("4. the sheet's picker, Delete");
  const extra = await run(gm, P.save, { fid, name: `picker-${RUN}-extra` });
  mine.push(extra.id);
  stood = await run(gm, P.disorder, { fid, saved: kept.cells });
  opened = await run(gm, P.pill, { partyId: party.id });
  note("pill", opened);
  answered = await run(gm, P.answer, { id: extra.id, action: "delete" });
  now = await state();
  check("the sheet's Load order pill opens the picker and Delete is pressed on the run's own order", opened.pill && opened.picker && answered.pressed && answered.gone, { opened, answered });
  check("the order is gone, the kept one stands and the party stands as it stood", !now.orders.includes(extra.id) && now.orders.includes(kept.id) && same(now.members, stood), now.members);
  check("one notice, naming the deleted order", now.notes.length === 1 && now.notes[0].includes(`picker-${RUN}-extra`), now.notes.length);

  section("5. the sheet's picker, Form up");
  stood = await run(gm, P.disorder, { fid, saved: kept.cells });
  opened = await run(gm, P.pill, { partyId: party.id });
  answered = await run(gm, P.answer, { id: kept.id, action: "apply" });
  now = await state();
  check("Form up from the sheet's picker lays the party into the saved order and keeps the order", opened.picker && answered.pressed && same(now.members, kept.cells) && now.orders.includes(kept.id), { opened, answered, members: now.members });
  await run(gm, P.closeSheet, { partyId: party.id });

  section("6. one saved order");
  // Reachable only where the run's order is the world's only one: other runs' orders are not this walk's to forget.
  if (others.length) {
    note("not walked", `the world holds ${others.length} saved order(s) of other runs, so the HUD opens its picker`);
  } else {
    note("the run's second order forgotten by its id", await run(gm, P.forget, { ids: [held.id] }));
    stood = await run(gm, P.disorder, { fid, saved: kept.cells });
    opened = await run(gm, P.hud, { partyId: party.id });
    await sleep(1500);
    now = await state();
    check("with one saved order the HUD's button forms the party up with no picker", opened.button && !opened.picker && same(now.members, kept.cells) && now.orders.includes(kept.id), { opened, members: now.members });
  }
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  tally.fail += 1;
} finally {
  section("teardown");
  if (gm) {
    try {
      await run(gm, P.answer, { id: null, action: null });
      note("the run's orders forgotten", await run(gm, P.forget, { ids: mine.filter(Boolean) }));
    } catch (err) { console.error("teardown:", err?.message ?? err); }
    note("ledger (gm)", "");
    try { await gm.close(); } catch {}
  }
  section("summary");
  console.log(`${tally.pass}/${tally.pass + tally.fail} checks passed`);
  process.exitCode = tally.fail ? 1 : 0;
}
