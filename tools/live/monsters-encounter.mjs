/**
 * Live walk, encounter lines: docs/monsters/TESTING.md "Encounter lines". Every
 * count the parser writes rolls on Foundry's own `Roll`; the Ecology tab's number
 * and unit reach core's number-appearing field by the sheet's own submit; the
 * statblock, the follower card and the group read a count of units as no body
 * count; a count fits the line fields at the narrowest window and the largest
 * type, and an observer can edit none of them; an observer pins a generator
 * template's axes and the client attempts no write;
 * and a repair in place turns a monster holding the old parser's shape
 * into what the page prints. Machine values arrive through ./_env.mjs, the book
 * through ACKS_TEST_BOOKS ("mm", "ax2"). A check prints ids, shapes and booleans, never
 * a book's words or figures; every line typed here is invented.
 *
 * Fixtures, kept and found again by marker (`api.fixture`): the hand-built
 * monster `monsters/encounter-typed`, and `monsters/encounter-units`,
 * `monsters/encounter-times`, `monsters/encounter-literal` and
 * `monsters/encounter-percent`, each an actor
 * standing for one cookbook entry by its `cookbook` flag, and the invented
 * generator template `monsters/pin-template` (two variants, one role cell).
 * Each section writes the shape it needs first: the typed monster's lines
 * blank, the template's axes and cells, and on the three the old parser's
 * writes. The cards the run posts are tracked by id and swept in
 * the finally. Writes outside the ledger: none. The book opens on this seat only
 * (`remember: false`).
 */
import { connect, sleep } from "./_driver.mjs";
import { seats as machineSeats, PORTS, books } from "./_env.mjs";
import { walkDone, blocked } from "./_walk.mjs";

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

/** The longest shape the parser writes, in invented figures, and the fontScale setting's maximum. */
const LONGEST_COUNT = "(1d6+2)*10";
const LARGEST_TYPE = 18;

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

  /**
   * The line fields' room at the window's own width and at the narrowest a hand
   * can reach. A resize stops at `min-width`, and the sheet theme's floor stands
   * above the frame's own, so the second measure drops the theme's body class and
   * lets a width of zero clamp to the floor left. `tooLong` is the control: the
   * measure that says `count` fits must say a run of it does not.
   */
  layout: async ({ count }) => {
    const H = globalThis.__el;
    const root = H.root(H.sheet);
    const fits = (input, text) => {
      const value = input.value;
      input.value = text;
      const ok = input.scrollWidth <= input.clientWidth;
      input.value = value;
      return ok;
    };
    const read = () => {
      const grid = root.querySelector(".acksm-enc-grid");
      const inputs = [...grid.querySelectorAll("input")];
      const numbers = inputs.filter((i) => i.name.endsWith(".number"));
      return {
        width: Math.round(root.getBoundingClientRect().width),
        font: getComputedStyle(numbers[0]).fontSize,
        slimmest: Math.round(Math.min(...inputs.map((i) => i.getBoundingClientRect().width))),
        rows: new Set(inputs.map((i) => Math.round(i.getBoundingClientRect().top))).size,
        overflow: grid.scrollWidth > grid.clientWidth,
        fits: numbers.every((i) => fits(i, count)),
        tooLong: !numbers.some((i) => fits(i, count.repeat(20))),
      };
    };
    const own = read();
    const body = document.body.classList;
    const themed = body.contains("acks-lib-sheet-theme");
    const before = root.style.width;
    body.remove("acks-lib-sheet-theme");
    root.style.width = "0px";
    const small = read();
    root.style.width = before;
    if (themed) body.add("acks-lib-sheet-theme");
    return { own, small, themed };
  },

  /** Writes the type knob on this page as `applyFontScale` does; the client setting stays as it was. */
  setBase: async ({ base }) => {
    const style = document.documentElement.style;
    const before = style.getPropertyValue("--acks-fs-base");
    if (base) style.setProperty("--acks-fs-base", base);
    else style.removeProperty("--acks-fs-base");
    return { before };
  },

  grantObserver: async ({ actorId, name }) => {
    const actor = game.actors.get(actorId);
    const user = game.users.find((u) => u.name === name);
    await actor.update({ ownership: { ...actor.ownership, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER } });
    return actor.ownership[user.id];
  },

  /** How this seat's Ecology tab offers the line fields. */
  lineFields: async () => {
    const H = globalThis.__el;
    const inputs = [...(H.root(H.sheet)?.querySelectorAll(".acksm-enc-grid input") ?? [])];
    return { inputs: inputs.length, disabled: inputs.filter((i) => i.disabled || i.readOnly).length };
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

  /** Write the template's axes and cells, so a kept fixture starts every run in one shape. */
  shapeTemplate: async ({ actorId, axes, cells }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ "system.output": { actorType: "monster", nameFormat: "{variant} {role}" }, "system.axes": axes, "system.cells": cells });
    return { axes: actor.system.axes.length, cells: actor.system.cells.length };
  },

  /** Open a template's builder sheet fresh on this seat and wait for its body. */
  openTemplate: async ({ actorId }) => {
    const H = globalThis.__el;
    const actor = game.actors.get(actorId);
    const app = actor.sheet;
    H.opened.push(app);
    H.tsheet = app;
    await app.render(true);
    const body = await H.poll(() => H.root(app)?.querySelector(".acks-lib-template-body"));
    return { rendered: !!body };
  },

  /** The axis selects as this seat draws them, and whether a Generate button is offered. */
  templateSelects: async () => {
    const H = globalThis.__el;
    const root = H.root(H.tsheet);
    return {
      generate: !!root?.querySelector("[data-action='generate']"),
      selects: [...(root?.querySelectorAll("select.acks-lib-template-pin") ?? [])].map((s) => ({
        axis: s.dataset.axis,
        named: !!s.getAttribute("name"),
        marked: [...s.options].some((o) => o.disabled && /\(.+\)$/.test(o.textContent.trim())),
      })),
    };
  },

  /** Pin axes the way a hand does (the select's value, then its change) and count every actor write this client attempts. */
  observePin: async ({ actorId, pins }) => {
    const H = globalThis.__el;
    const attempted = [];
    const hook = Hooks.on("preUpdateActor", (doc) => { if (doc.id === actorId) attempted.push(doc.id); });
    const before = JSON.stringify(game.actors.get(actorId).toObject().system);
    let ok = true;
    for (const [axis, value] of pins) {
      const s = H.root(H.tsheet)?.querySelector(`select.acks-lib-template-pin[data-axis='${axis}']`);
      if (!s) { ok = false; break; }
      s.value = value;
      s.dispatchEvent(new Event("change", { bubbles: true }));
      await H.sleep(500);
      await H.poll(() => H.root(H.tsheet)?.querySelector(`select.acks-lib-template-pin[data-axis='${axis}']`)?.value === value, { tries: 20, every: 100 });
    }
    await H.sleep(800);
    Hooks.off("preUpdateActor", hook);
    return { ok, attempted: attempted.length, unchanged: JSON.stringify(game.actors.get(actorId).toObject().system) === before };
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
let player = null;
const cards = [];
try {
  section("seat and book");
  gm = await connect({ browser, origin, user: SEATS.gm, port: PORTS.gm, own: MACHINE.own });
  note("gm ready after (s)", await ready(gm, "gm"));
  const installed = await run(gm, P.install);
  note("install", installed);
  check("the GM seat is the active GM", installed.isGM && installed.activeGMIsSelf, installed.module);
  if (!installed.activeGMIsSelf) blocked("another GM client is the active GM");

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
  const roomy = ({ own, small }) => [own, small].every((l) => l.fits && l.tooLong && !l.overflow);
  const layout = await run(gm, P.layout, { count: LONGEST_COUNT });
  note("layout", layout);
  check("the window narrowed to the floor a hand can reach", layout.small.width < layout.own.width, layout);
  check("a count fits the line fields at the window's width and at that floor, with no overflow", roomy(layout), layout);
  const knob = await run(gm, P.setBase, { base: `${LARGEST_TYPE}px` });
  await run(gm, P.closeAll);
  await run(gm, P.openSheet, { actorId: typed.id });
  const large = await run(gm, P.layout, { count: LONGEST_COUNT });
  await run(gm, P.setBase, { base: knob.before });
  await run(gm, P.closeAll);
  await run(gm, P.openSheet, { actorId: typed.id });
  note("layout at the largest type", large);
  check("the largest type size reaches the line fields", parseFloat(large.own.font) > parseFloat(layout.own.font), { from: layout.own.font, to: large.own.font });
  check("and a count still fits them at both widths", roomy(large), large);
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

  section("a seat that only observes");
  note("granted", await run(gm, P.grantObserver, { actorId: typed.id, name: MACHINE.player }));
  player = await connect({ browser, origin, user: MACHINE.player, port: PORTS.player, own: MACHINE.own });
  note("player ready after (s)", await ready(player, "player"));
  await run(player, P.install);
  await run(player, P.openSheet, { actorId: typed.id });
  const offered = await run(player, P.lineFields);
  check("an observer sees the line fields and can edit none", offered.inputs === 12 && offered.disabled === 12, offered);
  note("closed (player)", await run(player, P.closeAll));

  // The pin is per window and writes nothing: the Role select re-marks what the chosen variant has no cell for.
  const tpl = await gm.fixture("monsters/pin-template", "Actor", { name: "Pin Template", type: "acks-extras.template" });
  const option = (key, label) => ({ key, label, nameLabel: "", merge: {}, items: [], flags: {}, token: {} });
  note("template shaped", await run(gm, P.shapeTemplate, {
    actorId: tpl.id,
    axes: [
      { key: "variant", label: "Variant", roll: "", default: "", options: [option("a", "Variant A"), option("b", "Variant B")] },
      { key: "role", label: "Role", roll: "", default: "standard", options: [option("standard", "Standard"), option("champion", "Champion")] },
    ],
    cells: [{ by: ["variant", "role"], key: "a|champion", merge: {}, items: [], flags: {} }],
  }));
  note("granted (template)", await run(gm, P.grantObserver, { actorId: tpl.id, name: MACHINE.player }));
  await run(player, P.openTemplate, { actorId: tpl.id });
  const before = await run(player, P.templateSelects);
  check("an observer's template sheet draws its axis selects with no name and no Generate", before.selects.length === 2 && before.selects.every((s) => !s.named) && !before.generate, before);
  const pin = await run(player, P.observePin, { actorId: tpl.id, pins: [["variant", "b"]] });
  const after = await run(player, P.templateSelects);
  check("pinning a variant re-marks the roles it has no cell for, and the client attempts no write", pin.ok && pin.attempted === 0 && pin.unchanged && after.selects.find((s) => s.axis === "role")?.marked, { ...pin, marked: after.selects.find((s) => s.axis === "role")?.marked });
  note("closed (player)", await run(player, P.closeAll));

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
  walkDone();
} catch (err) {
  console.error("WALK ERROR:", err?.stack ?? err?.message ?? err);
  checks.push(["the walk ran to its end", false]);
} finally {
  section("teardown");
  if (player) {
    try { await player.close(); } catch {}
  }
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
