/**
 * Live walk, character-sheet-add-proficiency: adding a class or general
 * proficiency by hand from the character sheet's Abilities tab, driven from
 * a real Player seat. Walks docs/character-sheet/TESTING.md "Adding a
 * proficiency by hand, from a Player seat": each list's button offers the
 * list a Player can read and files the pick as that list's type, a second
 * pick of the same proficiency is a second copy, closing the window makes
 * nothing, a character with no class gets a blank class proficiency, and
 * Blank makes one where a list exists. Prints booleans and counts, never a
 * proficiency's name. Machine values arrive through ./_env.mjs.
 *
 * Fixtures, kept and found by marker (the GM seat builds them):
 * `character-sheet/hand-proficiency`, a character the Player owns, bound to
 * the first imported class whose own list resolves at least one proficiency;
 * `character-sheet/hand-proficiency-bare`, a character the Player owns with
 * no class. A kept copy carries what past runs added, so each step reads a
 * count before it and asserts the change. The proficiencies the walk adds are
 * its own and are swept by uuid.
 */
import { connect, sleep } from "./_driver.mjs";
import { walkDone } from "./_walk.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const BOUND = "character-sheet/hand-proficiency";
const BARE = "character-sheet/hand-proficiency-bare";

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
    const H = (globalThis.__hp = globalThis.__hp ?? {});
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
    return { isGM: game.user.isGM, userId: game.user.id };
  },
  userId: async ({ name }) => game.users.find((u) => u.name === name)?.id ?? null,
  /** Bind the bound fixture to the first imported class whose own list resolves a proficiency, unless it holds one already. */
  bindClass: async ({ actorId }) => {
    const R = await import("/modules/acks-extras/scripts/classes/registry.mjs");
    const A = await import("/modules/acks-extras/scripts/abilities/add-proficiency.mjs");
    const L = await import("/modules/acks-extras/scripts/lib/library.mjs");
    await L.whenReady();
    const actor = game.actors.get(actorId);
    const held = await R.classForActorAsync(actor);
    if (held && A.proficiencyOptions(actor, "class", held).length) return { bound: true, already: true, options: A.proficiencyOptions(actor, "class", held).length };
    for (const cls of R.classItems().sort((a, b) => R.classSortKey(a) - R.classSortKey(b))) {
      if (!A.proficiencyOptions(actor, "class", cls).length) continue;
      const applied = await acksExtras.classes.applyClass(actor, cls, { level: 1, confirm: false, rebuildVitals: false });
      const now = await R.classForActorAsync(actor);
      return { bound: !!applied && !!now, already: false, options: now ? A.proficiencyOptions(actor, "class", now).length : 0 };
    }
    return { bound: false, classes: R.classItems().length };
  },
  open: async ({ actorId }) => {
    const H = globalThis.__hp;
    const actor = game.actors.get(actorId);
    await actor.sheet.render(true);
    await H.poll(() => H.root(actor.sheet)?.isConnected);
    actor.sheet.changeTab("abilities", "primary");
    await H.sleep(500);
    const root = H.root(actor.sheet);
    const chip = (list) => root?.querySelector(`[data-action='proficiencyCreate'][data-list='${list}']`);
    return {
      rendered: !!root,
      classChip: !!chip("class") && chip("class").tagName === "BUTTON",
      generalChip: !!chip("general") && chip("general").tagName === "BUTTON",
      tips: ["class", "general"].every((l) => !!chip(l)?.dataset.tooltip),
    };
  },
  /** Press one list's button and answer what it asks: "pick" (the first offered), "repick" (the same one again), "blank" or "close". */
  press: async ({ actorId, list, answer }) => {
    const H = globalThis.__hp;
    const actor = game.actors.get(actorId);
    const root = H.root(actor.sheet);
    const chip = root?.querySelector(`[data-action='proficiencyCreate'][data-list='${list}']`);
    if (!chip) return { chip: false };
    const before = new Set(actor.items.map((i) => i.id));
    const seen = new Set(H.apps());
    chip.click();
    const dialog = await H.poll(() => H.apps().find((a) => !seen.has(a) && a instanceof foundry.applications.api.DialogV2 && H.root(a)?.isConnected), { tries: 30, every: 200 });
    let offered = 0;
    let focusable = null;
    let sameBefore = null;
    if (dialog) {
      const d = H.root(dialog);
      const select = d.querySelector("select[name='ref']");
      const opts = select ? [...select.options].filter((o) => o.value) : [];
      offered = opts.length;
      const controls = [...d.querySelectorAll("select, button")];
      focusable = controls.length > 0 && controls.every((c) => !c.disabled && c.tabIndex >= 0);
      if (answer === "pick" || answer === "repick") {
        const pick = answer === "repick" ? opts.find((o) => o.value === H.lastRef) : opts[0];
        if (answer === "repick") sameBefore = actor.items.filter((i) => i.name === H.lastMade).length;
        else H.lastRef = pick?.value ?? null;
        select.value = pick?.value ?? "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        d.querySelector("button[data-action='pick']")?.click();
      } else if (answer === "blank") {
        d.querySelector("button[data-action='blank']")?.click();
      } else {
        d.querySelector("header [data-action='close']")?.click();
      }
    }
    const made = answer === "close" ? (await H.sleep(800), null) : await H.poll(() => actor.items.filter((i) => !before.has(i.id)).length && actor.items.filter((i) => !before.has(i.id)), { tries: 30, every: 200 });
    const items = made ? [...made] : [];
    const first = items[0] ?? null;
    let sheetOpened = false;
    if (first) {
      sheetOpened = !!(await H.poll(() => H.apps().some((a) => a.document?.uuid === first.uuid && H.root(a)?.isConnected), { tries: 10, every: 200 }));
      for (const a of H.apps()) if (a.document?.uuid === first.uuid) await a.close();
    }
    let sameAfter = null;
    if (answer === "pick" && first) H.lastMade = first.name;
    if (answer === "repick") sameAfter = first?.name === H.lastMade ? actor.items.filter((i) => i.name === H.lastMade).length : -1;
    return {
      chip: true,
      dialog: !!dialog,
      offered,
      focusable,
      created: actor.items.size - before.size,
      uuids: items.map((i) => i.uuid),
      type: first?.system?.proficiencytype ?? null,
      isAbility: first ? first.type === "ability" : null,
      sheetOpened,
      sameBefore,
      sameAfter,
    };
  },
  close: async ({ actorId }) => { await game.actors.get(actorId)?.sheet?.close(); return true; },
  drain: async () => ({ errors: globalThis.__hp.errors.slice() }),
  restore: async () => {
    const H = globalThis.__hp;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.classes?.applyClass`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
let player = null;
const made = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 420_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { gm?.close(); } catch {}
  try { player?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const keep = async (result) => {
  for (const uuid of result?.uuids ?? []) { made.push(uuid); await gm.track(uuid, "Item"); }
  return result;
};

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  check("the GM seat is a GM", (await run(gm, P.install)).isGM);
  const playerId = await run(gm, P.userId, { name: MACHINE.player });
  if (!playerId) throw new Error("no Player user on this world");

  section("fixtures");
  const bound = await gm.fixture(BOUND, "Actor", { name: "QA Hand Proficiency", type: "character", ownership: { default: 0, [playerId]: 3 } });
  const bare = await gm.fixture(BARE, "Actor", { name: "QA Hand Proficiency Bare", type: "character", ownership: { default: 0, [playerId]: 3 } });
  const boundId = bound.id ?? String(bound.uuid).split(".").pop();
  const bareId = bare.id ?? String(bare.uuid).split(".").pop();
  const binding = await run(gm, P.bindClass, { actorId: boundId });
  check("shape: the bound fixture holds an imported class whose own list resolves a proficiency", binding.bound && binding.options > 0, binding);

  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  check("the Player seat is not a GM", !(await run(player, P.install)).isGM);

  section("1–2, 6. each list's button, from the Player seat");
  const opened = await run(player, P.open, { actorId: boundId });
  check("the Abilities tab shows a Class proficiency and a General proficiency button, each with a tooltip", opened.rendered && opened.classChip && opened.generalChip && opened.tips, opened);
  const cls = await keep(await run(player, P.press, { actorId: boundId, list: "class", answer: "pick" }));
  check("Class proficiency offers the class's own list to a Player, every control reachable from the keyboard", cls.dialog && cls.offered > 0 && cls.focusable, { dialog: cls.dialog, offered: cls.offered, focusable: cls.focusable });
  check("the pick lands as one class proficiency", cls.created === 1 && cls.isAbility && cls.type === "class", { created: cls.created, type: cls.type });
  const gen = await keep(await run(player, P.press, { actorId: boundId, list: "general", answer: "pick" }));
  check("General proficiency offers the general list and the pick lands as one general proficiency", gen.dialog && gen.offered > 0 && gen.created === 1 && gen.type === "general", { dialog: gen.dialog, offered: gen.offered, created: gen.created, type: gen.type });

  section("3. the same pick again, and a closed window");
  const again = await keep(await run(player, P.press, { actorId: boundId, list: "general", answer: "repick" }));
  check("the same proficiency picked again is a second copy, nothing dropped", again.created === 1 && again.sameAfter === again.sameBefore + 1, { created: again.created, before: again.sameBefore, after: again.sameAfter });
  const closed = await run(player, P.press, { actorId: boundId, list: "general", answer: "close" });
  check("closing the window with no pick makes nothing", closed.dialog && closed.created === 0, { dialog: closed.dialog, created: closed.created });

  section("5. Blank where a list exists");
  const blank = await keep(await run(player, P.press, { actorId: boundId, list: "class", answer: "blank" }));
  check("Blank makes one empty class proficiency and opens its sheet", blank.dialog && blank.created === 1 && blank.type === "class" && blank.sheetOpened, { created: blank.created, type: blank.type, sheetOpened: blank.sheetOpened });
  await run(player, P.close, { actorId: boundId });

  section("4. a character with no class");
  await run(player, P.open, { actorId: bareId });
  const none = await keep(await run(player, P.press, { actorId: bareId, list: "class", answer: "blank" }));
  check("with no class bound there is no window: a blank class proficiency is made and its sheet opens", !none.dialog && none.created === 1 && none.type === "class" && none.sheetOpened, { dialog: none.dialog, created: none.created, type: none.type, sheetOpened: none.sheetOpened });
  await run(player, P.close, { actorId: bareId });

  const pe = await run(player, P.drain);
  const ge = await run(gm, P.drain);
  check("no console error on either seat over the walk", !pe.errors.length && !ge.errors.length, { player: pe.errors.slice(0, 3), gm: ge.errors.slice(0, 3) });
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err);
  checks.push(["walk ran to the end", false]);
} finally {
  section("teardown");
  if (gm && made.length) {
    try { note("added proficiencies swept", await gm.sweepTracked({ only: made })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  }
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  console.log(`fixtures kept: ${BOUND}, ${BARE}`);
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
