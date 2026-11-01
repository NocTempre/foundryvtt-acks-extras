/**
 * Live walk, encounter lines: docs/monsters/TESTING.md "Encounter lines". Every
 * count the parser writes rolls on Foundry's own `Roll`; the Ecology tab's number
 * and unit reach core's number-appearing field by the sheet's own submit; the
 * statblock, the follower card and the group read a count of units as no body
 * count; and a repair in place turns a monster holding the old parser's shape
 * into what the page prints. Machine values arrive through ./_env.mjs, the book
 * through ACKS_TEST_BOOKS ("mm", "ax2"). A check prints ids, shapes and booleans, never
 * a book's words or figures; every line typed here is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the hand-built
 * monster `monsters/encounter-typed`, and `monsters/encounter-units`,
 * `monsters/encounter-times`, `monsters/encounter-literal` and
 * `monsters/encounter-percent`, each an actor
 * standing for one cookbook entry by its `cookbook` flag. Each section writes the
 * shape it needs first: the typed monster's lines blank, and on the three the
 * old parser's writes. The cards the run posts are tracked by id and swept in
 * the finally. Writes outside the ledger: none. The book opens on this seat only
 * (`remember: false`).
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";

const MACHINE = machineSeats();
const { browser, origin } = MACHINE;
const SEATS = { gm: MACHINE.gm };
const BOOKS = books(["mm", "ax2"]);

/**
 * One entry of each shape. `old` is what the two old readers stored for such a
 * line, in invented figures: the first die anywhere in core's field, and a
 * one-sided line copied to the lair.
 */
const ENTRIES = [
  { marker: "monsters/encounter-units", id: "mm.beastmanOrc", context: "wilderness", key: "w" },
  { marker: "monsters/encounter-times", id: "mm.equineHeavyHorse", context: "wilderness", key: "w" },
  { marker: "monsters/encounter-literal", id: "mm.bearBlack", context: "dungeon", key: "d" },
  { marker: "monsters/encounter-percent", id: "ax2.golemUndeadBoneLesser", context: "dungeon", key: "d" },
];

const note = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const section = (title) => console.log(`\n== ${title} ==`);
const checks = [];
const check = (label, ok, detail) => {
  checks.push([label, !!ok]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};

/* ------------------------------------------------------------------ */
/*  Page side                                                           */
/* ------------------------------------------------------------------ */

const P = {
  install: async () => {
    const H = (globalThis.__el = globalThis.__el ?? {});
    H.EL = await import("/modules/acks-extras/scripts/lib/encounter-line.mjs");
    H.GL = await import("/modules/acks-extras/scripts/lib/group-logic.mjs");
    H.CB = await import("/modules/acks-extras/scripts/importer/cookbook.mjs");
    H.ME = (await import("/modules/acks-extras/scripts/monsters/monster-extras.mjs")).default;
    H.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    H.poll = async (fn, { tries = 40, every = 150 } = {}) => {
      for (let n = 0; n < tries; n++) {
        const v = await fn();
        if (v) return v;
        await H.sleep(every);
      }
      return null;
    };
    H.root = (app) => (app?.element?.nodeType === 1 ? app.element : app?.element?.[0]) ?? null;
    H.text = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    H.opened = [];
    // A row that cannot roll carries no data-roll; its pin always does.
    H.rowOf = (id) => H.root(H.sheet)?.querySelector(`[data-action='pinRoll'][data-roll='${id}']`)?.closest(".acks-extras-frame__row") ?? null;
    return {
      module: game.modules.get("acks-extras")?.version ?? null,
      isGM: game.user.isGM,
      activeGMIsSelf: !!game.users.activeGM?.isSelf,
    };
  },

  connectBook: async ({ id, path }) => {
    if (globalThis.__el.CB.cookbookSessionDoc(id)) return { already: true };
    globalThis.__elBook = { done: false };
    acksExtras.importer.connectBookUrl(id, path, { remember: false, bridge: false })
      .then(() => { globalThis.__elBook = { done: true, ok: true }; })
      .catch((e) => { globalThis.__elBook = { done: true, ok: false, error: String(e?.message ?? e) }; });
    return { started: true };
  },
  bookState: async ({ id }) => ({ ...globalThis.__elBook, open: !!globalThis.__el.CB.cookbookSessionDoc(id) }),

  /** Each invented line parsed in the page, and its formula rolled on Foundry's own Roll a few times. */
  rolls: async ({ lines }) => {
    const { EL } = globalThis.__el;
    const out = [];
    for (const { line, low, high } of lines) {
      const formula = EL.appearingFormula(EL.parseEncounterLine(line));
      const totals = [];
      let error = null;
      try {
        for (let n = 0; n < 40; n++) totals.push((await new Roll(formula).evaluate()).total);
      } catch (err) {
        error = String(err?.message ?? err);
      }
      out.push({ formula, error, inRange: !error && totals.every((t) => Number.isInteger(t) && t >= low && t <= high) });
    }
    return out;
  },

  /** A blank formula on Foundry's own Roll. */
  blankRoll: async () => {
    try {
      const roll = await new Roll("").evaluate();
      return { threw: false, total: roll.total };
    } catch (err) {
      return { threw: true, message: String(err?.message ?? err).slice(0, 120) };
    }
  },

  /** The typed monster with its lines blank, whatever the last run left. */
  blankLines: async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const empty = { noun: "", number: "", unit: "" };
    await actor.update({
      "flags.acks-extras.extras.encounter.wilderness": { wandering: { ...empty }, lair: { ...empty } },
      "system.details.appearing": { d: "", w: "" },
    });
    return actor.system.details.appearing;
  },

  openSheet: async ({ actorId }) => {
    const H = globalThis.__el;
    const actor = game.actors.get(actorId);
    const Cls = Object.values(CONFIG.Actor.sheetClasses.monster).map((e) => e.cls).find((c) => c.name === "FullMonsterSheet");
    const app = new Cls({ document: actor });
    H.opened.push(app);
    H.sheet = app;
    await app.render(true);
    await app.changeTab("ecology", "primary");
    const root = await H.poll(() => (H.root(app)?.querySelector(".acksm-enc-grid") ? H.root(app) : null));
    return { rendered: !!root, units: root?.querySelectorAll(".acksm-enc-grid input[name$='.unit']").length ?? 0 };
  },

  /** Type into one Ecology field the way a user does: a value, then the change event its form submits on. */
  type: async ({ actorId, field, value, read }) => {
    const H = globalThis.__el;
    const actor = game.actors.get(actorId);
    const app = H.sheet;
    const input = H.root(app)?.querySelector(`.acksm-enc-grid input[name$='.encounter.${field}']`);
    if (!input) return { found: false };
    input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const landed = await H.poll(() => foundry.utils.getProperty(actor.getFlag("acks-extras", "extras"), `encounter.${field}`) === value);
    await H.poll(() => H.root(app)?.querySelector(`.acksm-enc-grid input[name$='.encounter.${field}']`)?.value === value);
    return { found: true, landed: !!landed, appearing: actor.system.details.appearing[read] };
  },

  /** The statblock's encounter row as the sheet draws it. */
  statRow: async ({ id }) => {
    const H = globalThis.__el;
    await H.sheet.changeTab("statblock", "primary");
    const row = await H.poll(() => H.rowOf(id));
    return row ? { found: true, text: H.text(row), rollable: row.classList.contains("is-roll"), tip: !!row.querySelector("[data-tooltip-text]") } : { found: false };
  },

  /** Press a statblock row and read what posts under the actor's speaker. */
  pressRow: async ({ actorId, id }) => {
    const H = globalThis.__el;
    const row = H.rowOf(id);
    if (!row) return { found: false, posted: [] };
    const posted = [];
    const hook = Hooks.on("createChatMessage", (m) => { if (m.speaker?.actor === actorId) posted.push(m.id); });
    (row.querySelector(".acks-extras-frame__row-line") ?? row).click();
    await H.poll(() => posted.length > 0, { tries: 12, every: 200 });
    Hooks.off("createChatMessage", hook);
    const card = document.createElement("div");
    card.innerHTML = game.messages.get(posted[0])?.content ?? "";
    return { found: true, posted, formula: H.text(card.querySelector(".dice-formula")) || null, total: H.text(card.querySelector(".dice-total")) || null };
  },

  /** The follower card's number-appearing dice. */
  cardDice: async ({ actorId }) => {
    const H = globalThis.__el;
    const actor = game.actors.get(actorId);
    const app = new acksExtras.lib.followerCard.Sheet({ document: actor });
    H.opened.push(app);
    await app.render(true);
    await H.poll(() => H.root(app)?.querySelector(".acks-lib-follower-card"));
    return [...H.root(app).querySelectorAll("[data-action='fcRollAppearing']")].map((b) => b.dataset.check);
  },

  sizeOf: async ({ actorId, context }) => globalThis.__el.GL.sizeFromEcology(game.actors.get(actorId), context),

  /**
   * Write what the old parser left on the actor, then repair it in place, and
   * read the shape back. `read` returns no figure of the book's.
   */
  repair: async ({ actorId, id, context, key }) => {
    const H = globalThis.__el;
    const actor = game.actors.get(actorId);
    const stale = { noun: "Stale", number: "1d7", unit: "" };
    await actor.update({
      name: actor.name,
      "flags.acks-extras.cookbook.id": id,
      "system.details.appearing": { d: "1d7", w: "1d7" },
      [`flags.acks-extras.extras.encounter.${context}`]: { wandering: { ...stale }, lair: { ...stale } },
    });
    const done = await H.CB.refillMonster(actor, { whole: true });
    const line = actor.getFlag("acks-extras", "extras")?.encounter?.[context] ?? {};
    const formula = actor.system.details.appearing[key];
    let rolled = null;
    if (formula) {
      try {
        const totals = [];
        for (let n = 0; n < 20; n++) totals.push((await new Roll(formula).evaluate()).total);
        rolled = totals.every((t) => Number.isInteger(t) && t > 0);
      } catch {
        rolled = false;
      }
    }
    return {
      ok: !!done?.ok,
      reason: done?.reason ?? null,
      blankFormula: formula === "",
      literal: /^\d+$/.test(formula),
      multiplied: /\*\d+$/.test(formula),
      rolled,
      staleGone: line.wandering?.noun !== "Stale" && line.lair?.noun !== "Stale",
      wanderingUnit: !!line.wandering?.unit,
      wanderingCount: !!line.wandering?.number,
      wanderingRolls: line.wandering?.number ? (await new Roll(line.wandering.number).evaluate()).total > 0 : false,
      lairCount: !!line.lair?.number,
      size: H.GL.sizeFromEcology(actor, context) === null ? "null" : "formula",
      lairChanceReads: Number.isInteger(H.ME.fromActor(actor).encounter?.lairChance),
    };
  },

  closeAll: async () => {
    const H = globalThis.__el;
    let n = 0;
    for (const app of H?.opened ?? []) { try { await app.close({ force: true }); n++; } catch {} }
    if (H) H.opened = [];
    return n;
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
    try { ok = await api.eval(`typeof game !== "undefined" && game.ready === true && !!globalThis.acksExtras?.importer?.connectBookUrl`); } catch { ok = false; }
    if (ok) return Math.round((Date.now() - t0) / 1000);
    if (Date.now() - t0 > seconds * 1000) throw new Error(`${label}: not ready after ${seconds}s`);
    await sleep(1000);
  }
}

let gm = null;
const cards = [];
try {
  section("seat and book");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  note("install", installed);
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, installed.module);
  if (!installed.activeGMIsSelf) throw new Error("another GM client is the active GM");

  section("Roll");
  // Each low and high is what the invented dice can throw.
  const LINES = [
    { line: "Knot (3d5) / Roost (9)", low: 3, high: 15 },
    { line: "Knot (4)", low: 4, high: 4 },
    { line: "Knot (1d7×20)", low: 20, high: 140 },
    { line: "Knot (2d7+1)", low: 3, high: 15 },
    { line: "Knot (1d7+2×20)", low: 60, high: 180 },
  ];
  const rolled = await run(gm, P.rolls, { lines: LINES });
  note("rolled", rolled);
  check("Foundry's Roll takes every count the parser writes, and each total sits in its dice's range", rolled.every((r) => r.inRange), rolled.map((r) => r.formula));
  const blank = await run(gm, P.blankRoll);
  check("Foundry's Roll throws on a blank formula, so no reader may hand it one", blank.threw, blank.message);

  section("the Ecology tab");
  const typed = await gm.fixture("monsters/encounter-typed", "Actor", { name: "Encounter Typed", type: "monster", items: [] });
  note("cleared", await run(gm, P.blankLines, { actorId: typed.id }));
  const sheet = await run(gm, P.openSheet, { actorId: typed.id });
  check("the Ecology tab draws a unit field on all four sides", sheet.rendered && sheet.units === 4, sheet);
  const count = await run(gm, P.type, { actorId: typed.id, field: "wilderness.wandering.number", value: "2d7", read: "w" });
  check("a typed count reaches core's field", count.landed && count.appearing === "2d7", count);
  const unit = await run(gm, P.type, { actorId: typed.id, field: "wilderness.wandering.unit", value: "knots", read: "w" });
  check("naming its unit stores the unit and blanks core's field", unit.landed && unit.appearing === "", unit);

  section("a count of units on every reader");
  const row = await run(gm, P.statRow, { id: "enc:wilderness" });
  note("statblock row", row);
  check("the statblock reads the count with its unit", row.found && row.text.includes("2d7 knots"), row.text);
  const pressed = await run(gm, P.pressRow, { actorId: typed.id, id: "enc:wilderness" });
  for (const id of pressed.posted ?? []) cards.push(gm.track(id, "ChatMessage"));
  note("pressed", pressed);
  check("the row offers no roll of a count in units, says why, and a press posts none", row.rollable === false && row.tip && (pressed.posted ?? []).length === 0, { rollable: row.rollable, tip: row.tip, posted: (pressed.posted ?? []).length });
  check("the follower card has no die for it", (await run(gm, P.cardDice, { actorId: typed.id })).length === 0);
  check("the group sizes nothing from it", (await run(gm, P.sizeOf, { actorId: typed.id, context: "wilderness" })) === null);
  note("closed", await run(gm, P.closeAll));

  section("the same field back in bodies");
  await run(gm, P.openSheet, { actorId: typed.id });
  const cleared = await run(gm, P.type, { actorId: typed.id, field: "wilderness.wandering.unit", value: "", read: "w" });
  check("clearing the unit restores core's formula", cleared.landed && cleared.appearing === "2d7", cleared);
  const bodyRow = await run(gm, P.statRow, { id: "enc:wilderness" });
  const posted = await run(gm, P.pressRow, { actorId: typed.id, id: "enc:wilderness" });
  for (const id of posted.posted ?? []) cards.push(gm.track(id, "ChatMessage"));
  check("the statblock's row then rolls it", bodyRow.rollable && posted.posted.length === 1 && posted.formula === "2d7", { formula: posted.formula });
  note("closed", await run(gm, P.closeAll));

  section("a repair in place");
  if (BOOKS.length < 2) throw new Error("ACKS_TEST_BOOKS names no path for mm and ax2");
  for (const book of BOOKS) {
    note(`connect ${book.id}`, await run(gm, P.connectBook, book));
    let state = await run(gm, P.bookState, { id: book.id });
    for (let n = 0; n < 60 && !state.open && !state.done; n++) { await sleep(2000); state = await run(gm, P.bookState, { id: book.id }); }
    note(`book ${book.id}`, state);
    if (!state.open) throw new Error(`${book.id} did not open: ${state.error ?? "timed out"}`);
  }
  const repaired = {};
  for (const { marker, id, context, key } of ENTRIES) {
    const actor = await gm.fixture(marker, "Actor", { name: marker, type: "monster", items: [] });
    repaired[marker] = await run(gm, P.repair, { actorId: actor.id, id, context, key });
    note(`repaired ${marker}`, repaired[marker]);
  }
  const units = repaired["monsters/encounter-units"];
  check("a unit line keeps its unit and its count, and core's stale die goes", units.ok && units.blankFormula && units.wanderingUnit && units.wanderingRolls && units.staleGone, units);
  check("and the group sizes nothing from it", units.size === "null");
  const times = repaired["monsters/encounter-times"];
  check("a multiplied die keeps its multiplier and rolls", times.ok && times.multiplied && times.rolled === true && times.staleGone, times);
  check("a one-sided line leaves no lair count", !times.lairCount, times);
  const literal = repaired["monsters/encounter-literal"];
  check("a literal count is core's formula, and it rolls", literal.ok && literal.literal && literal.rolled === true && literal.staleGone, literal);
  const percent = repaired["monsters/encounter-percent"];
  check("a lair chance printed as a percent reads as a number", percent.ok && percent.lairChanceReads, percent);
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (gm) {
    try { note("closed", await run(gm, P.closeAll)); } catch (err) { console.error("closeAll:", err?.message ?? err); }
    try { note("cards swept", await gm.sweepTracked({ only: cards })); } catch (err) { console.error("sweep:", err?.message ?? err); }
    try { await gm.close(); } catch {}
  }
  section("summary");
  for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  const passed = checks.filter(([, ok]) => ok).length;
  console.log(`${passed}/${checks.length} checks passed`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
