/**
 * Live walk, equipment-add-effect: the item sheet's one Add Effect control.
 * Walks docs/equipment/TESTING.md step 8 on the GM seat: an item with no
 * effect opens in the simple view, whose footer offers Add Effect and no
 * Add Light; the choice it opens makes a Magic Light (two empty `upgrade`
 * radius changes) and opens it; the item then shows its tab strip, and the
 * Effects tab's one Add Effect makes a blank effect; closing the choice by
 * its header button makes nothing. Machine values arrive through ./_env.mjs.
 *
 * Fixture, kept and found by marker: `equipment/add-effect-item`, a world
 * item with nothing that earns a tab of its own. Each run removes any effect
 * the fixture carries before its first check, so it opens simple; the effects
 * the walk makes are its own and are swept by uuid.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const MARKER = "equipment/add-effect-item";

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in the seat's page. */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__ae = globalThis.__ae ?? {});
    H.ES = await import("/modules/acks-extras/scripts/lib/effect-scan.mjs");
    H.LT = await import("/modules/acks-extras/scripts/lib/light.mjs");
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    H.apps = () => [...foundry.applications.instances.values()];
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
    }
    return { isGM: game.user.isGM };
  },
  /** The fixture's known shape: no effect, so it opens simple. Its effects are this walk's earlier leavings. */
  shape: async ({ itemId }) => {
    const item = game.items.get(itemId);
    const ids = item.effects.map((e) => e.id);
    if (ids.length) await item.deleteEmbeddedDocuments("ActiveEffect", ids);
    return { cleared: ids.length, effects: item.effects.size };
  },
  open: async ({ itemId }) => {
    const H = globalThis.__ae;
    const item = game.items.get(itemId);
    await item.sheet.render(true);
    const root = await H.poll(() => H.root(item.sheet)?.isConnected && H.root(item.sheet));
    await H.sleep(300);
    const foot = root?.querySelector(".acks-extras-item-sheet__simple-foot");
    return {
      rendered: !!root,
      simple: !!foot,
      footAdd: !!foot?.querySelector("[data-action='addEffect']"),
      footLight: !!root?.querySelector("[data-action='addLight']"),
      tabs: !!root?.querySelector("nav.tabs, .tabs [data-tab]"),
    };
  },
  /** Click the Add Effect control the sheet shows, then answer the choice: a button's action, or "close". */
  add: async ({ itemId, answer, tab = null }) => {
    const H = globalThis.__ae;
    const item = game.items.get(itemId);
    if (tab) { item.sheet.changeTab?.(tab, "primary"); await H.sleep(300); }
    const root = H.root(item.sheet);
    const control = [...root.querySelectorAll("[data-action='addEffect']")].find((b) => b.offsetParent !== null) ?? root.querySelector("[data-action='addEffect']");
    if (!control) return { control: false };
    const before = new Set(item.effects.map((e) => e.id));
    const seen = new Set(H.apps());
    control.click();
    const dialog = await H.poll(() => H.apps().find((a) => !seen.has(a) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.isConnected));
    const droot = H.root(dialog);
    const buttons = droot ? [...droot.querySelectorAll("footer button[data-action], .form-footer button[data-action]")].map((b) => b.dataset.action) : [];
    const scroll = !!droot?.classList.contains("acks-extras-scroll");
    if (!dialog) return { control: true, dialog: false };
    if (answer === "close") droot.querySelector("header [data-action='close']")?.click();
    else droot.querySelector(`button[data-action='${answer}']`)?.click();
    await H.sleep(answer === "close" ? 800 : 0);
    const made = answer === "close" ? null : await H.poll(() => item.effects.find((e) => !before.has(e.id)));
    const sheetOpen = made ? !!(await H.poll(() => H.apps().some((a) => a.document?.uuid === made.uuid && H.root(a)?.isConnected), { tries: 30, every: 200 })) : false;
    if (sheetOpen) for (const a of H.apps()) if (a.document?.uuid === made.uuid) await a.close();
    const keys = made ? (made.changes ?? []).map((c) => c.key) : [];
    return {
      control: true,
      dialog: true,
      buttons,
      scroll,
      created: item.effects.size - before.size,
      uuid: made?.uuid ?? null,
      transfer: made ? !!made.transfer : null,
      changes: keys.length,
      lightKeys: made ? keys.includes(H.LT.MAGIC_LIGHT_CHANGE_KEYS.bright) && keys.includes(H.LT.MAGIC_LIGHT_CHANGE_KEYS.dim) : null,
      upgradeEmpty: made ? (made.changes ?? []).every((c) => (c.type ?? c.mode) === H.ES.CHANGE.UPGRADE && String(c.value ?? "") === "") : null,
      sheetOpen,
    };
  },
  close: async ({ itemId }) => { await game.items.get(itemId)?.sheet?.close(); return true; },
  drain: async () => ({ errors: globalThis.__ae.errors.slice() }),
  restore: async () => {
    const H = globalThis.__ae;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.equipment`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let itemId = null;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 300_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seat`);
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

try {
  section("seat");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  check("the seat is a GM", (await run(gm, P.install)).isGM);

  section("fixture");
  const fixture = await gm.fixture(MARKER, "Item", { name: "Walk sample sheet", type: "item", system: { quantity: { value: 1, max: 0 }, cost: 1 } });
  itemId = fixture.id ?? String(fixture.uuid).split(".").pop();
  const shaped = await run(gm, P.shape, { itemId });
  check("shape: the fixture carries no effect", shaped.effects === 0, shaped);

  section("8. the simple view's footer");
  const first = await run(gm, P.open, { itemId });
  check("an item with no effect opens simple, its footer offering Add Effect and no Add Light", first.rendered && first.simple && first.footAdd && !first.footLight, first);
  const light = await run(gm, P.add, { itemId, answer: "light" });
  if (light.uuid) { made.push(light.uuid); await gm.track(light.uuid, "ActiveEffect"); }
  check("the control opens one choice, Blank Effect or Magic Light, inside the scroll contract", light.dialog && light.scroll && light.buttons.join(",") === "blank,light", { buttons: light.buttons, scroll: light.scroll });
  check("Magic Light makes one transferred effect with both radius changes, upgrade and empty, and opens it", light.created === 1 && light.transfer && light.changes === 2 && light.lightKeys && light.upgradeEmpty && light.sheetOpen, light);

  section("8. the Effects tab");
  const second = await run(gm, P.open, { itemId });
  check("with an effect the item is no longer simple, and no Add Light shows", !second.simple && !second.footLight, second);
  const blank = await run(gm, P.add, { itemId, answer: "blank", tab: "effects" });
  if (blank.uuid) { made.push(blank.uuid); await gm.track(blank.uuid, "ActiveEffect"); }
  check("the Effects tab's one Add Effect makes a blank transferred effect with no change, and opens it", blank.control && blank.created === 1 && blank.transfer && blank.changes === 0 && blank.sheetOpen, blank);
  const closed = await run(gm, P.add, { itemId, answer: "close", tab: "effects" });
  check("closing the choice by its header button makes nothing", closed.dialog && closed.created === 0, { dialog: closed.dialog, created: closed.created });

  await run(gm, P.close, { itemId });
  const drained = await run(gm, P.drain);
  check("no console error over the walk", !drained.errors.length, drained.errors.slice(0, 3));
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && made.length) {
    try { note("effects swept", await gm.sweepTracked({ only: made })); } catch (err) { console.error("effect sweep:", err?.message ?? err); }
  }
  try { if (gm) note("restored", await run(gm, P.restore)); } catch (err) { console.error("restore:", err?.message ?? err); }
  console.log(`fixture kept: ${MARKER}`);
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
