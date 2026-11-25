/**
 * Live walk, magic-summon-list: a summoning spell's creature list in the
 * effect-row editor (`scripts/lib/summon-list.mjs`, the window in
 * `scripts/lib/apps/effect-row-editor.mjs`). Walks docs/magic/TESTING.md "A
 * summoning spell's creature list" on the GM and Player seats.
 *   1. The window on the standing shape: the creature block holds one line named
 *      by the creature, with a where-from note, a Number box that reads the
 *      row's number and carries a tooltip, a Remove button, and the form holds
 *      no `ref` and no `amount` control.
 *   2. Add by uuid: the flag gains a row that copies the open row's format,
 *      control, band and number under a key of its own, with no importer mark and
 *      no name; the window opens again on the same row, now with two lines.
 *   3. Add the same uuid, and Add with the box blank: nothing is written.
 *   4. A real `drop` of an Actor on the block adds a third line.
 *   5. The Number box: a figure writes only its own row, blank writes null and
 *      never 0, a negative figure writes nothing.
 *   6. The importer's mark: a row the import wrote reads its figure as read from
 *      the book; a change by hand takes the mark off and the tooltip reads as set
 *      by hand.
 *   7. Two lists: rows that differ in control are two lists of one line each.
 *   8. The Player seat (owner of the spell's caster): the Mechanics tab and the
 *      window name a creature the seat cannot open by the neutral label alone,
 *      with no name, no uuid and no where-from source.
 *   9. The Player seat writes the Number, removes lines (the last removal keeps
 *      the row and blanks its creature, and then offers no Remove).
 *  10. No console error and no uncaught error on either seat. The recorders
 *      attach after `ready`, so a clean console here says nothing about `init`,
 *      `setup` or `ready`.
 * Prints booleans and counts, never a creature's name, a uuid or a user id; the
 * ledger's own sweep report is the one place ids print. A name a check compares
 * with is read and compared in the page, or handed to the page as an argument.
 * Machine values arrive through ./_env.mjs. The selectors are derived from the
 * window's template and the actions' code and have not been run.
 *
 * Fixtures, kept and found by marker (the GM seat builds what is missing):
 * `magic/list-creature-a` and `magic/list-creature-b` (monsters at default None,
 * each with an Observer entry for the Player's user, written by the fixtures step
 * from the id the Player seat reads for itself), `magic/list-creature-closed` (a
 * monster at default None with no entry for the Player; a stray entry is taken
 * off by replacing the ownership map whole), `magic/list-caster` (a character
 * the Player owns, spells enabled) and `magic/list-spell` (a spell on it, its
 * flag rewritten whole by every step that needs a shape). The walk makes no other
 * document: its teardown sweeps what it tracked, which is nothing, and quotes the
 * sweep's result. Every window it opened is closed on both seats.
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS } from "./_env.mjs";
import { walkDone, blocked, WalkBlocked } from "./_walk.mjs";
import { REGISTER_ORIGIN, SUMMON_FORMATS, CONTROL_KINDS } from "../../scripts/lib/magic-vocab.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/** The summon format and the two control kinds the walk's rows carry, from the vocabulary. */
const [FORMAT] = Object.keys(SUMMON_FORMATS);
const [CONTROL_A, CONTROL_B] = Object.keys(CONTROL_KINDS);
/** The standing number of every row the walk writes. */
const AMOUNT = 2;
/** The spell's duration: the walk's own, a fixed two hours. */
const DURATION = { shape: "fixed", value: 2, unit: "hours" };

/* ------------------------------------------------------------------ */
/*  Page side: each function is stringified and run in a seat's page.  */
/* ------------------------------------------------------------------ */
const P = {
  install: async () => {
    const H = (globalThis.__msl = globalThis.__msl ?? {});
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => { for (let n = 0; n < tries; n++) { const v = await fn(); if (v) return v; await H.sleep(every); } return null; };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0] ?? null);
    /** The spell as this seat holds it. */
    H.item = (uuid) => fromUuidSync(uuid);
    /** The spell's effect rows as stored, as plain data. */
    H.rows = (uuid) => JSON.parse(JSON.stringify(Array.from(H.item(uuid)?.getFlag("acks-extras", "spell")?.effects ?? [])));
    /** Every effect-row window open on this seat. */
    H.editors = () => [...foundry.applications.instances.values()].filter((a) => a.element?.classList?.contains("acks-extras-effect-editor"));
    /** The rendered window on a row index, other than `not`. */
    H.editor = (index, not = null) => H.editors().find((e) => e.rendered && e.index === index && e !== not) ?? null;
    H.lineEls = (ed) => [...(ed?.element?.querySelectorAll(".acks-extras-summon-line") ?? [])];
    /** The window on a row index once its creature block is drawn (and, where `lines` is given, holds that many lines); a window that is not `prev`. */
    H.waitEditor = (index, { prev = null, lines = null } = {}) =>
      H.poll(() => {
        const e = H.editor(index, prev);
        if (!e?.element?.querySelector("[data-acks-extras-summon-list]")) return null;
        if (lines !== null && H.lineEls(e).length !== lines) return null;
        return e;
      }, { tries: 80, every: 150 });
    /**
     * What a window shows of its creature block, as booleans and short strings. `expect[i]` says what line i must read: `{uuid}` (the name of the creature the uuid names, read here), `{label}` (a name handed in) or `{neutral: true}` (the seat's neutral label); `forbid` lists strings the line's markup must not hold anywhere. A line with no expectation answers null.
     */
    H.view = (ed, expect = []) => {
      const neutral = game.i18n.localize("ACKS-LIB.summons.neutral");
      const els = H.lineEls(ed);
      return {
        index: ed.index,
        count: els.length,
        noRef: !ed.element.querySelector('[name="ref"]'),
        noAmount: !ed.element.querySelector('[name="amount"]'),
        lines: els.map((li, i) => {
          const label = li.querySelector(".acks-extras-summon-name")?.textContent.trim() ?? "";
          const box = li.querySelector("[data-summon-amount]");
          const want = expect[i] ?? null;
          const wanted = !want ? null : want.uuid ? (fromUuidSync(want.uuid)?.name ?? null) : want.neutral ? neutral : want.label;
          return {
            matches: want ? !!wanted && label === wanted : null,
            clean: want ? (want.forbid ?? []).every((s) => !s || !li.outerHTML.includes(s)) : null,
            from: [...li.querySelectorAll(".acks-extras-summon-from")].map((s) => s.textContent.trim()),
            amount: box?.value ?? null,
            tip: box?.dataset.tooltipText ?? null,
            remove: !!li.querySelector('[data-action="summonRemove"]'),
            blank: !!li.querySelector(".acks-extras-summon-name.is-blank"),
          };
        }),
      };
    };
    if (!H.patched) {
      H.patched = true;
      H.errors = [];
      H.uncaught = [];
      H.consoleError = console.error;
      console.error = (...args) => { H.errors.push(args.map((a) => a?.message ?? String(a)).join(" ").slice(0, 300)); H.consoleError(...args); };
      H.onError = (e) => H.uncaught.push(String(e.message ?? "").slice(0, 200));
      H.onRejection = (e) => H.uncaught.push("rejection: " + String(e.reason?.message ?? e.reason ?? "").slice(0, 200));
      window.addEventListener("error", H.onError);
      window.addEventListener("unhandledrejection", H.onRejection);
    }
    const auto = await import("/modules/acks-extras/scripts/lib/automation-client.mjs");
    await Promise.race([auto.automationSettled(), H.sleep(20000)]);
    return { isGM: game.user.isGM, role: game.user.role, activeGMIsSelf: !!game.users.activeGM?.isSelf };
  },
  /** The id of the user this seat is, as the page itself holds it. */
  selfId: async () => game.user.id,
  /** Everything the seat's recorders caught since the last read; reading clears it. */
  drain: async () => {
    const H = globalThis.__msl;
    const out = { errors: H.errors.slice(), uncaught: H.uncaught.slice() };
    H.errors.length = 0;
    H.uncaught.length = 0;
    return out;
  },
  restore: async () => {
    const H = globalThis.__msl;
    if (!H?.patched) return "never installed";
    console.error = H.consoleError;
    window.removeEventListener("error", H.onError);
    window.removeEventListener("unhandledrejection", H.onRejection);
    H.patched = false;
    return "restored";
  },
  clearWindows: async () => {
    for (const app of [...foundry.applications.instances.values()]) if (app.hasFrame && app.rendered) await app.close({ animate: false });
    try { ui.notifications.clear?.(); } catch { /* chrome only */ }
    return true;
  },
  /** A localized string as this seat reads it. */
  loc: async ({ key, data }) => game.i18n.format(key, data ?? {}),
  /** The name of the document a uuid names, as this seat reads it (handed on as an argument, never printed). */
  nameOf: async ({ uuid }) => String(fromUuidSync(uuid)?.name ?? ""),
  /** Whether this seat's user owns the caster and is no GM. */
  owns: async ({ casterId }) => ({ isGM: game.user.isGM, owner: !!game.actors.get(casterId)?.isOwner }),
  /** On the Judge's seat: write a user's level on a world document, or take the entry off (`level` null), and read what the document stores. */
  setLevel: async ({ uuid, userId, level }) => {
    const doc = await fromUuid(uuid);
    // A user's entry is taken off as core's own ownership form takes it off: the map is replaced whole without the key. A deletion of the one key leaves it standing.
    const rest = { ...doc._source.ownership };
    delete rest[userId];
    await doc.update(level === null ? { ownership: new foundry.data.operators.ForcedReplacement(rest) } : { [`ownership.${userId}`]: level });
    const source = doc._source.ownership ?? {};
    return { stored: source[userId] ?? null, keyed: Object.hasOwn(source, userId), def: source.default ?? null };
  },
  /** On a seat: whether it resolves the creature and may observe it. */
  observes: async ({ uuid }) => {
    let doc = null;
    try { doc = await fromUuid(uuid); } catch { doc = null; }
    return { resolves: !!doc, observes: !!doc?.testUserPermission(game.user, "OBSERVER") };
  },
  /** The caster's known shape: spells enabled. */
  shapeCaster: async ({ casterId }) => {
    const actor = game.actors.get(casterId);
    if (!actor.system.spells?.enabled) await actor.update({ "system.spells.enabled": true });
    return { enabled: !!actor.system.spells?.enabled, type: actor.type };
  },
  /** The spell's effect rows as this seat reads them. */
  rows: async ({ uuid }) => globalThis.__msl.rows(uuid),
  /** The spell's flag replaced whole (the old flag deleted first): the summoning school, the rows given and a duration. Every window of a row is closed first. */
  shape: async ({ uuid, rows, duration }) => {
    const H = globalThis.__msl;
    for (const e of H.editors()) await e.close();
    const item = H.item(uuid);
    await item.update({ "flags.acks-extras.spell": new foundry.data.operators.ForcedDeletion() });
    await item.update({ "flags.acks-extras.spell": { schools: ["summoning"], effects: rows, duration } });
    return { rows: H.rows(uuid).length };
  },
  /**
   * Open the spell's row window as a user does: the sheet on its Mechanics tab, the row's edit control pressed. `expect` is read as `H.view` reads it.
   */
  open: async ({ uuid, index, expect }) => {
    const H = globalThis.__msl;
    for (const e of H.editors()) await e.close();
    const item = H.item(uuid);
    await item.sheet.render({ force: true, tab: "mechanics" });
    await H.poll(() => item.sheet.rendered);
    item.sheet.changeTab?.("mechanics", "primary");
    const edit = await H.poll(() => item.sheet.element?.querySelector(`[data-action="effectEdit"][data-index="${index}"]`));
    if (!edit) return { opened: false, why: "no edit control on the row" };
    edit.click();
    const ed = await H.waitEditor(index);
    if (!ed) return { opened: false, why: "no row window" };
    return { opened: true, ...H.view(ed, expect) };
  },
  /** The window on a row index as it reads now, without waiting. */
  view: async ({ index, expect }) => {
    const H = globalThis.__msl;
    const ed = H.editor(index);
    return ed ? { open: true, ...H.view(ed, expect) } : { open: false };
  },
  /**
   * Type `ref` in the uuid box and press Add. `reopen` waits for the new window the add makes (a press that writes closes every window of the store and opens the row again) and reads it; `nothing` waits long enough for a write to show and answers whether the same window still stands.
   */
  add: async ({ index, ref, mode, lines }) => {
    const H = globalThis.__msl;
    const prev = H.editor(index);
    const box = prev?.element?.querySelector("[data-summon-add]");
    const press = prev?.element?.querySelector('[data-action="summonAdd"]');
    if (!box || !press) return { ok: false };
    box.value = ref;
    box.dispatchEvent(new Event("input", { bubbles: true }));
    press.click();
    if (mode === "nothing") {
      await H.sleep(1500);
      const now = H.editor(index);
      return { ok: true, same: now === prev, count: H.lineEls(now).length };
    }
    const ed = await H.waitEditor(index, { prev, lines });
    return { ok: true, reopened: !!ed, ...(ed ? H.view(ed) : {}) };
  },
  /** Drop an Actor on the creature block with a real `drop` event, then wait for the window the add reopens. */
  drop: async ({ index, uuid, lines }) => {
    const H = globalThis.__msl;
    const prev = H.editor(index);
    const list = prev?.element?.querySelector("[data-acks-extras-summon-list]");
    if (!list) return { ok: false };
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify({ type: "Actor", uuid }));
    list.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    const ed = await H.waitEditor(index, { prev, lines });
    return { ok: true, reopened: !!ed };
  },
  /**
   * Type `text` in a line's Number box and fire its `change`. With `expectWrite` it waits for the rows to change; without, long enough for a write to show. Answers whether the rows changed and whether the box kept what was typed.
   */
  amount: async ({ index, line, text, uuid, expectWrite }) => {
    const H = globalThis.__msl;
    const ed = H.editor(index);
    const box = H.lineEls(ed)[line]?.querySelector("[data-summon-amount]");
    if (!box) return { ok: false };
    const before = JSON.stringify(H.rows(uuid));
    box.value = text;
    const typed = box.value === text;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    if (expectWrite) await H.poll(() => JSON.stringify(H.rows(uuid)) !== before, { tries: 50, every: 100 });
    else await H.sleep(1500);
    await H.sleep(700);
    return { ok: true, typed, changed: JSON.stringify(H.rows(uuid)) !== before, open: !!H.editor(index) };
  },
  /** Press a line's Remove, then wait for the window the removal reopens (with `lines` lines) and read it. */
  remove: async ({ index, line, lines }) => {
    const H = globalThis.__msl;
    const prev = H.editor(index);
    const press = H.lineEls(prev)[line]?.querySelector('[data-action="summonRemove"]');
    if (!press) return { ok: false };
    press.click();
    const ed = await H.waitEditor(index, { prev, lines });
    return { ok: true, reopened: !!ed, ...(ed ? H.view(ed) : {}) };
  },
  /**
   * The spell's Mechanics tab as this seat draws it: the effect lines, each read against `expect` as `H.view` reads it (a name or the neutral label is looked for in the line's text, a forbidden string in all of its markup).
   */
  mechanics: async ({ uuid, expect }) => {
    const H = globalThis.__msl;
    const item = H.item(uuid);
    await item.sheet.render({ force: true, tab: "mechanics" });
    await H.poll(() => item.sheet.rendered);
    item.sheet.changeTab?.("mechanics", "primary");
    await H.sleep(500);
    const neutral = game.i18n.localize("ACKS-LIB.summons.neutral");
    const els = [...(item.sheet.element?.querySelectorAll(".acks-magic-effect") ?? [])];
    return {
      count: els.length,
      lines: els.map((li, i) => {
        const text = li.querySelector(".acks-magic-effect-text")?.textContent ?? "";
        const want = expect[i] ?? null;
        const wanted = !want ? null : want.neutral ? neutral : want.label;
        return { matches: want ? !!wanted && text.includes(wanted) : null, clean: want ? (want.forbid ?? []).every((s) => !s || !li.outerHTML.includes(s)) : null };
      }),
    };
  },
};

/* ------------------------------------------------------------------ */
/*  Driver side                                                         */
/* ------------------------------------------------------------------ */
async function run(api, fn, ...args) {
  const text = await api.eval(`(${fn.toString()})(...${JSON.stringify(args)}).then((v) => JSON.stringify(v === undefined ? null : v))`);
  return JSON.parse(text);
}

async function ready(api, label, { seconds = 240 } = {}) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.magic`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

/** Poll a page read until `test(result)` holds or the tries run out; the last read is returned. */
async function until(api, fn, args, test, { tries = 40, every = 250 } = {}) {
  let last = null;
  for (let n = 0; n < tries; n++) {
    last = await run(api, fn, args);
    if (test(last)) return last;
    await sleep(every);
  }
  return last;
}

let gm = null;
let player = null;
/** The uuids of what this run made: the only documents teardown deletes. The walk makes none, so it stays empty. */
const own = [];
const WALL_MS = Number(process.env.WALK_WALL_MS ?? 900_000);
setTimeout(() => {
  console.error(`WALK ERROR: wall clock of ${WALL_MS} ms reached; closing the seats`);
  try { player?.close(); } catch {}
  try { gm?.close(); } catch {}
  process.exit(1);
}, WALL_MS).unref();

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const summonRows = (rows) => rows.filter((r) => r.type === "summon");

try {
  section("seats");
  gm = await connect({ browser, origin, user: MACHINE.gm, port: PORTS.gm, own: MACHINE.own });
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  note("player ready after (s)", await ready(player, "player"));
  const installed = await run(gm, P.install);
  const seated = await run(player, P.install);
  if (!installed.isGM || !installed.activeGMIsSelf) blocked("the first seat is not the active GM");
  if (seated.isGM) blocked("the second seat is a GM, so a Player's view cannot be walked");
  check("the GM seat is the active GM and the player seat is a player", installed.isGM && installed.activeGMIsSelf && !seated.isGM && seated.role <= 2, { gm: installed.role, player: seated.role });

  section("fixtures");
  const playerId = await run(player, P.selfId);
  if (!playerId) throw new Error("the Player seat reads no user id");
  const creatureA = await gm.fixture("magic/list-creature-a", "Actor", { name: "QA List Creature A", type: "monster", ownership: { default: 0 } });
  const creatureB = await gm.fixture("magic/list-creature-b", "Actor", { name: "QA List Creature B", type: "monster", ownership: { default: 0 } });
  const creatureClosed = await gm.fixture("magic/list-creature-closed", "Actor", { name: "QA List Creature Closed", type: "monster", ownership: { default: 0 } });
  const caster = await gm.fixture("magic/list-caster", "Actor", {
    name: "QA List Caster", type: "character", prototypeToken: { actorLink: true }, system: { spells: { enabled: true }, hp: { value: 9, max: 9 } }, ownership: { default: 0, [playerId]: 3 },
  });
  const spell = await gm.fixture("magic/list-spell", "Item", { name: "QA List Spell", type: "spell", system: { lvl: 1, cast: 0, memorized: 0 } }, { parent: caster.uuid });
  const idOf = (doc) => doc.id ?? String(doc.uuid).split(".").pop();
  const aUuid = creatureA.uuid;
  const bUuid = creatureB.uuid;
  const closedUuid = creatureClosed.uuid;
  const casterId = idOf(caster);
  const spellUuid = spell.uuid;

  const grantA = await run(gm, P.setLevel, { uuid: aUuid, userId: playerId, level: 2 });
  const grantB = await run(gm, P.setLevel, { uuid: bUuid, userId: playerId, level: 2 });
  const strip = await run(gm, P.setLevel, { uuid: closedUuid, userId: playerId, level: null });
  check("shape: creatures a and b hold Observer for the Player's user at default None, and the closed creature holds no entry for it at default None", grantA.stored === 2 && grantA.def === 0 && grantB.stored === 2 && grantB.def === 0 && !strip.keyed && strip.stored === null && strip.def === 0, { a: grantA.stored, b: grantB.stored, closedKeyed: strip.keyed, closedDefault: strip.def });
  const seeA = await until(player, P.observes, { uuid: aUuid }, (r) => r.observes);
  const seeB = await until(player, P.observes, { uuid: bUuid }, (r) => r.observes);
  const seeClosed = await until(player, P.observes, { uuid: closedUuid }, (r) => !r.observes, { tries: 20 });
  check("the Player seat observes creatures a and b, and resolves the closed creature by its uuid without observing it", seeA.observes && seeB.observes && seeClosed.resolves && !seeClosed.observes, { a: seeA.observes, b: seeB.observes, closedResolves: seeClosed.resolves, closedObserves: seeClosed.observes });
  const casterShape = await run(gm, P.shapeCaster, { casterId });
  const ownsCaster = await run(player, P.owns, { casterId });
  check("shape: the caster is a character with spells enabled, and the Player seat (no GM) owns it", casterShape.enabled && casterShape.type === "character" && ownsCaster.owner && !ownsCaster.isGM, { enabled: casterShape.enabled, owner: ownsCaster.owner });
  await run(player, P.drain);
  await run(gm, P.drain);

  /** A summon row of the standing shape, `over` laid on it. */
  const rowOf = (key, ref, over = {}) => ({ key, type: "summon", ref, amount: AMOUNT, summonFormat: FORMAT, control: CONTROL_A, origin: "", name: "", ...over });
  /** The spell's flag rewritten whole on the GM seat, then both seats read the rows back. */
  const shape = async (rows) => {
    await run(player, P.clearWindows);
    await run(gm, P.shape, { uuid: spellUuid, rows, duration: DURATION });
    const keys = rows.map((r) => r.key);
    const ours = (r) => r.length === rows.length && r.every((x, i) => x.key === keys[i]);
    const onGm = await until(gm, P.rows, { uuid: spellUuid }, ours);
    const onPlayer = await until(player, P.rows, { uuid: spellUuid }, ours);
    return { gm: ours(onGm), player: ours(onPlayer) };
  };
  const rowsOf = (seat) => run(seat, P.rows, { uuid: spellUuid });
  const line = (view, i) => view.lines?.[i] ?? {};

  /* ---------------------------------------------------------------- */
  section("1. the window on the standing shape");
  const shaped1 = await shape([rowOf("_walkListA", aUuid)]);
  check("1: the spell holds one summon row on both seats", shaped1.gm && shaped1.player, shaped1);
  const v1 = await run(gm, P.open, { uuid: spellUuid, index: 0, expect: [{ uuid: aUuid }] });
  check("1: the row's window opens with the creature block holding one line", v1.opened && v1.count === 1, { opened: v1.opened, lines: v1.count ?? 0, why: v1.why ?? null });
  check("1: the line's name equals the creature's name", line(v1, 0).matches === true, { named: line(v1, 0).matches ?? null });
  check("1: the line carries a where-from note", (line(v1, 0).from ?? []).some((t) => t.length > 0), { notes: line(v1, 0).from?.length ?? 0 });
  check("1: the Number box reads the row's number and carries a tooltip", line(v1, 0).amount === String(AMOUNT) && !!line(v1, 0).tip, { amount: line(v1, 0).amount, tipped: !!line(v1, 0).tip });
  check("1: the form holds no ref control and no amount control", v1.noRef === true && v1.noAmount === true, { noRef: v1.noRef, noAmount: v1.noAmount });
  check("1: the line has a Remove button", line(v1, 0).remove === true);

  /* ---------------------------------------------------------------- */
  section("2. Add by uuid");
  const shaped2 = await shape([rowOf("_walkListA", aUuid)]);
  const v2open = await run(gm, P.open, { uuid: spellUuid, index: 0, expect: [{ uuid: aUuid }] });
  check("2: the window is open on the standing shape", shaped2.gm && v2open.opened && v2open.count === 1, { count: v2open.count ?? 0 });
  const added2 = await run(gm, P.add, { index: 0, ref: bUuid, mode: "reopen", lines: 2 });
  const rows2 = await until(gm, P.rows, { uuid: spellUuid }, (r) => summonRows(r).length === 2);
  const [open2, new2] = rows2;
  check("2: the flag holds two summon rows", summonRows(rows2).length === 2, { summon: summonRows(rows2).length, rows: rows2.length });
  check("2: the new row names creature b and copies the open row's format, control, band and number", new2?.ref === bUuid && new2.summonFormat === open2.summonFormat && new2.control === open2.control && (new2.invocationFrom ?? null) === (open2.invocationFrom ?? null) && (new2.invocationTo ?? null) === (open2.invocationTo ?? null) && new2.amount === open2.amount, { ref: new2?.ref === bUuid, format: new2?.summonFormat === open2?.summonFormat, control: new2?.control === open2?.control, amount: new2?.amount === open2?.amount });
  check("2: the new row has a key of its own, a blank importer mark and a blank name", !!new2?.key && new2.key !== open2.key && (new2.origin ?? "") === "" && (new2.name ?? "") === "", { ownKey: !!new2?.key && new2.key !== open2.key, origin: new2?.origin ?? "", name: (new2?.name ?? "") === "" });
  check("2: the window is open again on the same row index and shows two lines", added2.ok && added2.reopened && added2.index === 0 && added2.count === 2, { reopened: added2.reopened, index: added2.index, lines: added2.count ?? 0 });

  /* ---------------------------------------------------------------- */
  section("3. the same uuid again, and a blank box, add nothing");
  const before3 = await rowsOf(gm);
  const dup3 = await run(gm, P.add, { index: 0, ref: bUuid, mode: "nothing" });
  const afterDup3 = await rowsOf(gm);
  const blank3 = await run(gm, P.add, { index: 0, ref: "", mode: "nothing" });
  const afterBlank3 = await rowsOf(gm);
  check("3: Add with the same uuid leaves the flag's rows unchanged", dup3.ok && same(before3, afterDup3), { ok: dup3.ok, unchanged: same(before3, afterDup3), rows: afterDup3.length });
  check("3: Add with the box blank leaves the flag's rows unchanged", blank3.ok && same(before3, afterBlank3), { ok: blank3.ok, unchanged: same(before3, afterBlank3), rows: afterBlank3.length });
  check("3: the window stood still through both presses with two lines", dup3.same && blank3.same && blank3.count === 2, { dup: dup3.same, blank: blank3.same, lines: blank3.count ?? 0 });

  /* ---------------------------------------------------------------- */
  section("4. a creature dropped on the block is added");
  const dropped4 = await run(gm, P.drop, { index: 0, uuid: closedUuid, lines: 3 });
  const rows4 = await until(gm, P.rows, { uuid: spellUuid }, (r) => summonRows(r).length === 3);
  const v4 = await run(gm, P.view, { index: 0, expect: [null, null, { uuid: closedUuid }] });
  check("4: the drop adds a third summon row", dropped4.ok && summonRows(rows4).length === 3, { summon: summonRows(rows4).length });
  check("4: the window is open again with three lines, and the third line's name equals the closed creature's name on the GM seat", dropped4.reopened && v4.open && v4.count === 3 && line(v4, 2).matches === true, { reopened: dropped4.reopened, lines: v4.count ?? 0, named: line(v4, 2).matches ?? null });

  /* ---------------------------------------------------------------- */
  section("5. the Number box");
  const base5 = await rowsOf(gm);
  const set3 = await run(gm, P.amount, { index: 0, line: 1, text: "3", uuid: spellUuid, expectWrite: true });
  const rows5a = await rowsOf(gm);
  check("5: a 3 typed on line 2 writes that row's amount and no other", set3.ok && set3.changed && rows5a[1].amount === 3 && rows5a[0].amount === base5[0].amount && rows5a[2].amount === base5[2].amount, { changed: set3.changed, second: rows5a[1]?.amount, others: rows5a[0]?.amount === base5[0]?.amount && rows5a[2]?.amount === base5[2]?.amount });
  const setBlank = await run(gm, P.amount, { index: 0, line: 1, text: "", uuid: spellUuid, expectWrite: true });
  const rows5b = await rowsOf(gm);
  check("5: a blank box writes null for that row and never 0, the other rows' amounts unchanged", setBlank.ok && setBlank.changed && rows5b[1].amount === null && rows5b[0].amount === base5[0].amount && rows5b[2].amount === base5[2].amount, { changed: setBlank.changed, amount: rows5b[1]?.amount ?? "absent" });
  const before5 = await rowsOf(gm);
  const negative = await run(gm, P.amount, { index: 0, line: 0, text: "-1", uuid: spellUuid, expectWrite: false });
  const after5 = await rowsOf(gm);
  check("5: a -1 typed in the box (which keeps it) writes nothing", negative.ok && negative.typed && !negative.changed && same(before5, after5), { typed: negative.typed, changed: negative.changed });
  await run(gm, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("6. the importer's mark");
  const amountRead = await run(gm, P.loc, { key: "ACKS-LIB.effectEditor.tip.amountRead" });
  const amountHand = await run(gm, P.loc, { key: "ACKS-LIB.effectEditor.tip.amountHand" });
  const shaped6 = await shape([rowOf("walkListRegister", aUuid, { origin: REGISTER_ORIGIN })]);
  const v6 = await run(gm, P.open, { uuid: spellUuid, index: 0, expect: [{ uuid: aUuid }] });
  const tip6 = line(v6, 0).tip ?? "";
  check("6: with the importer's mark on the row the Number box's tooltip reads that the import wrote it, alone or followed by more", shaped6.gm && v6.opened && (tip6 === amountRead || tip6.startsWith(`${amountRead} · `)), { opened: v6.opened, read: tip6 === amountRead || tip6.startsWith(`${amountRead} · `) });
  const set4 = await run(gm, P.amount, { index: 0, line: 0, text: "4", uuid: spellUuid, expectWrite: true });
  const rows6 = await rowsOf(gm);
  check("6: a Number of 4 writes the row's amount and takes the mark off", set4.ok && set4.changed && rows6[0].amount === 4 && (rows6[0].origin ?? "") === "", { amount: rows6[0]?.amount, origin: rows6[0]?.origin ?? "" });
  const v6b = await until(gm, P.view, { index: 0, expect: [{ uuid: aUuid }] }, (v) => v.lines?.[0]?.tip === amountHand);
  check("6: the box's tooltip now reads that the row was set by hand", line(v6b, 0).tip === amountHand, { open: v6b.open, byHand: line(v6b, 0).tip === amountHand });
  await run(gm, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("7. rows that differ in control are two lists");
  const shaped7 = await shape([rowOf("_walkListA", aUuid, { control: CONTROL_A }), rowOf("_walkListB", bUuid, { control: CONTROL_B })]);
  const v7a = await run(gm, P.open, { uuid: spellUuid, index: 0, expect: [{ uuid: aUuid }] });
  const v7b = await run(gm, P.open, { uuid: spellUuid, index: 1, expect: [{ uuid: bUuid }] });
  check("7: the window on row 0 shows one line, the first creature's", shaped7.gm && v7a.opened && v7a.index === 0 && v7a.count === 1 && line(v7a, 0).matches === true, { lines: v7a.count ?? 0, named: line(v7a, 0).matches ?? null });
  check("7: the window on row 1 shows one line, the second creature's", v7b.opened && v7b.index === 1 && v7b.count === 1 && line(v7b, 0).matches === true, { lines: v7b.count ?? 0, named: line(v7b, 0).matches ?? null });
  await run(gm, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("8. the Player seat reads a creature it cannot open by the neutral label");
  const shaped8 = await shape([rowOf("_walkListA", aUuid), rowOf("_walkListB", bUuid), rowOf("_walkListC", closedUuid)]);
  check("8: the spell holds three summon rows on both seats", shaped8.gm && shaped8.player, shaped8);
  const nameA = await run(gm, P.nameOf, { uuid: aUuid });
  const nameB = await run(gm, P.nameOf, { uuid: bUuid });
  const nameClosed = await run(gm, P.nameOf, { uuid: closedUuid });
  const unreadable = await run(player, P.loc, { key: "ACKS-LIB.summons.refused.unreadable" });
  const expect8 = [{ label: nameA }, { label: nameB }, { neutral: true, forbid: [nameClosed, closedUuid, closedUuid.split(".").pop()] }];
  const mech8 = await until(player, P.mechanics, { uuid: spellUuid, expect: expect8 }, (r) => r.count === 3, { tries: 20, every: 500 });
  check("8: the Mechanics tab lists three summon lines, the first two reading the creatures' names", mech8.count === 3 && line(mech8, 0).matches === true && line(mech8, 1).matches === true, { lines: mech8.count, first: line(mech8, 0).matches ?? null, second: line(mech8, 1).matches ?? null });
  check("8: the closed creature's line holds the neutral label and neither its name nor its uuid", line(mech8, 2).matches === true && line(mech8, 2).clean === true, { neutral: line(mech8, 2).matches ?? null, clean: line(mech8, 2).clean ?? null });
  const v8 = await run(player, P.open, { uuid: spellUuid, index: 0, expect: expect8 });
  check("8: the row window on the Player seat shows three lines, the first two reading the creatures' names", v8.opened && v8.count === 3 && line(v8, 0).matches === true && line(v8, 1).matches === true, { opened: v8.opened, lines: v8.count ?? 0, why: v8.why ?? null });
  check("8: the third line reads the neutral label and its markup holds neither the name nor the uuid", line(v8, 2).matches === true && line(v8, 2).clean === true, { neutral: line(v8, 2).matches ?? null, clean: line(v8, 2).clean ?? null });
  check("8: the third line carries no where-from source: its one note is the unreadable string", (line(v8, 2).from ?? []).length === 1 && line(v8, 2).from[0] === unreadable, { notes: line(v8, 2).from?.length ?? 0, isUnreadable: line(v8, 2).from?.[0] === unreadable });
  check("8: the first two lines carry a where-from source and no unreadable note", [0, 1].every((i) => (line(v8, i).from ?? []).length >= 1 && !(line(v8, i).from ?? []).includes(unreadable)), { first: line(v8, 0).from?.length ?? 0, second: line(v8, 1).from?.length ?? 0 });
  await run(player, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("9. the Player seat writes the Number and removes lines");
  const shaped9 = await shape([rowOf("_walkListA", aUuid), rowOf("_walkListB", bUuid), rowOf("_walkListC", closedUuid)]);
  const v9 = await run(player, P.open, { uuid: spellUuid, index: 0, expect: [] });
  check("9: the row window is open on the Player seat with three lines", shaped9.player && v9.opened && v9.count === 3, { lines: v9.count ?? 0, why: v9.why ?? null });
  const set5 = await run(player, P.amount, { index: 0, line: 0, text: "5", uuid: spellUuid, expectWrite: true });
  const rows9a = await until(gm, P.rows, { uuid: spellUuid }, (r) => r[0]?.amount === 5);
  check("9: a 5 typed on line 1 on the Player seat reads on the GM seat as that row's amount", set5.ok && rows9a[0]?.amount === 5, { sent: set5.changed, onGm: rows9a[0]?.amount });
  const gone3 = await run(player, P.remove, { index: 0, line: 2, lines: 2 });
  const rows9b = await until(gm, P.rows, { uuid: spellUuid }, (r) => summonRows(r).length === 2);
  check("9: Remove on line 3 leaves two summon rows and none names the closed creature", gone3.ok && gone3.reopened && summonRows(rows9b).length === 2 && !rows9b.some((r) => r.ref === closedUuid), { reopened: gone3.reopened, summon: summonRows(rows9b).length, lines: gone3.count ?? 0 });
  const gone2 = await run(player, P.remove, { index: 0, line: 1, lines: 1 });
  const rows9c = await until(gm, P.rows, { uuid: spellUuid }, (r) => summonRows(r).length === 1);
  check("9: Remove on line 2 leaves one summon row, still naming the first creature", gone2.ok && gone2.reopened && summonRows(rows9c).length === 1 && rows9c[0]?.ref === aUuid, { reopened: gone2.reopened, summon: summonRows(rows9c).length, first: rows9c[0]?.ref === aUuid });
  const before9 = rows9c[0] ?? {};
  const gone1 = await run(player, P.remove, { index: 0, line: 0, lines: 1 });
  const rows9d = await until(gm, P.rows, { uuid: spellUuid }, (r) => summonRows(r).length === 1 && (r[0]?.ref ?? "") === "");
  const last = rows9d[0] ?? {};
  check("9: Remove on the last line keeps the one row, its ref blank, its amount, format and control as before", gone1.ok && summonRows(rows9d).length === 1 && (last.ref ?? "") === "" && last.amount === before9.amount && last.summonFormat === before9.summonFormat && last.control === before9.control, { rows: summonRows(rows9d).length, blank: (last.ref ?? "") === "", amount: last.amount === before9.amount, format: last.summonFormat === before9.summonFormat, control: last.control === before9.control });
  check("9: the window then shows one blank line with no Remove button", gone1.reopened && gone1.count === 1 && line(gone1, 0).blank === true && line(gone1, 0).remove === false, { lines: gone1.count ?? 0, blank: line(gone1, 0).blank ?? null, remove: line(gone1, 0).remove ?? null });
  await run(player, P.clearWindows);

  /* ---------------------------------------------------------------- */
  section("10. no console error on either seat");
  const pEnd = await run(player, P.drain);
  const gEnd = await run(gm, P.drain);
  check("10: no console error or uncaught error on the Player seat over the walk", !pEnd.errors.length && !pEnd.uncaught.length, { errors: pEnd.errors.length, uncaught: pEnd.uncaught.length });
  check("10: no console error or uncaught error on the GM seat over the walk", !gEnd.errors.length && !gEnd.uncaught.length, { errors: gEnd.errors.length, uncaught: gEnd.uncaught.length });
  walkDone();
} catch (err) {
  if (!(err instanceof WalkBlocked)) {
    console.error("WALK ERROR:", err?.stack ?? err);
    checks.push(["walk ran to the end", false]);
  }
} finally {
  section("teardown");
  for (const [label, seat] of [["gm", gm], ["player", player]]) {
    try { if (seat) await run(seat, P.clearWindows); } catch (err) { console.error(`close windows ${label}:`, err?.message ?? err); }
    try { if (seat) note(`restored (${label})`, await run(seat, P.restore)); } catch (err) { console.error(`restore ${label}:`, err?.message ?? err); }
  }
  // The ledger also holds any fixture `fixture` built this run; only the run's own documents go, and the walk makes none.
  try { if (gm) note("swept", await gm.sweepTracked({ only: own })); } catch (err) { console.error("sweep:", err?.message ?? err); }
  console.log("fixtures kept: magic/list-creature-a, magic/list-creature-b, magic/list-creature-closed, magic/list-caster, magic/list-spell");
  try { if (player) await player.close(); } catch {}
  try { if (gm) await gm.close(); } catch {}
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
