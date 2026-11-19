/**
 * The inline rung editor: a Judge edits the ladder of an invocation-level
 * figure (a level and the figure that holds from it) in the effect-row editor
 * and in the spell overview, as a draft kept until Save. Covers the pure
 * ladder model and its draft holder (add, remove, change, validation, a blank
 * figure staying blank, the by-hand marks, Restore), the window half (contexts,
 * the in-place painting, the listeners that keep a rung out of a
 * submit-on-change form), both windows' flows (a draft that survives a redraw,
 * one write per Save, Cancel, a Player read-only with no write), and every
 * template rendered offline. Every ladder and figure here is invented. Foundry
 * is mocked, so the schema, the live window and the real change event are not
 * run.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const lang = JSON.parse(read("lang/en.json"));

const getProperty = (o, path) => path.split(".").reduce((v, k) => v?.[k], o);
const setProperty = (o, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((v, k) => (v[k] ??= {}), o);
  target[last] = value;
  return true;
};

/** Foundry's merge as the sheet uses it: objects merge key by key, an array replaces whole, and nothing is edited in place. */
function mergeObject(original, other) {
  const out = structuredClone(original);
  for (const [k, v] of Object.entries(other ?? {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? mergeObject(out[k], v) : structuredClone(v);
  }
  return out;
}

const instances = new Map();
globalThis.foundry = {
  abstract: { DataModel: class {} },
  applications: {
    instances,
    api: {
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      ApplicationV2: class {
        constructor(options = {}) {
          this.options = options;
          this.id = options.id;
          this.renders = 0;
          this.closed = false;
        }
        render(arg) {
          this.renders++;
          this.lastRender = arg;
          if (arg === true) instances.set(this.id, this);
        }
        async _prepareContext() {
          return {};
        }
        async _onRender() {}
        async close() {
          this.closed = true;
          instances.delete(this.id);
          return this;
        }
      },
      DialogV2: {},
    },
  },
  utils: { randomID: () => "x", getProperty, setProperty, deepClone: (o) => structuredClone(o), escapeHTML: (s) => s, mergeObject },
};
const say = (key, data) => (data && Object.keys(data).length ? `${key} ${JSON.stringify(data)}` : key);
globalThis.game = { user: { isGM: true }, i18n: { format: say, localize: (key) => key, has: () => false } };

const L = await import("../scripts/lib/rung-ladder.mjs");
const V = await import("../scripts/lib/rung-view.mjs");
const { resolveLevelValue } = await import("../scripts/lib/vocab.mjs");
const { EffectRowEditor, mergeRowEdit, closeEffectEditors } = await import("../scripts/lib/apps/effect-row-editor.mjs");
const { default: Handlebars } = await import("handlebars");

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

/** An invented ladder: a sigil's figure at three invocation levels. */
const ladder = (...rungs) => ({ kind: "conditional", on: "invocationLevel", breakpoints: rungs.map(([atLevel, value, extra]) => ({ atLevel, value, ...(extra ?? {}) })) });
const IMPORTED = () => ladder([1, 3], [3, 5], [5, 8]);
const as = (lv, level) => resolveLevelValue(lv, 1, { invocationLevel: level });
const asGM = (isGM) => (globalThis.game.user = { isGM });

/* ------------------------------------------------------------------ */
/*  The ladder model                                                   */
/* ------------------------------------------------------------------ */

await t("a ladder on the invocation scale is told from every other level value, and the kind switch names it", () => {
  assert.equal(L.isInvocationLadder(IMPORTED()), true);
  assert.equal(L.isInvocationLadder({ kind: "conditional", on: "hitDice", breakpoints: [] }), false, "another scale");
  assert.equal(L.isInvocationLadder({ kind: "breakpoints", on: "invocationLevel" }), false, "a class-level ladder");
  assert.equal(L.isInvocationLadder(4), false);
  assert.equal(L.isInvocationLadder(undefined), false);
  assert.equal(L.kindChoiceOf(IMPORTED()), L.INVOCATION_KIND);
  assert.equal(L.kindChoiceOf({ kind: "perLevel" }), "perLevel");
  assert.equal(L.kindChoiceOf(4), "flat");
  assert.equal(L.kindChoiceOf(undefined), "flat");
});

await t("choosing the invocation kind builds the conditional on the scale, keeps the rungs it already held, and starts empty otherwise", () => {
  const fresh = L.withKindChoice({ kind: "flat", flat: 2 }, { kind: "invocation" });
  assert.deepEqual(fresh, { kind: "conditional", on: "invocationLevel", breakpoints: [] });
  const kept = L.withKindChoice({ kind: "flat", on: "invocationLevel", breakpoints: IMPORTED().breakpoints }, { kind: "invocation" });
  assert.deepEqual(kept.breakpoints, IMPORTED().breakpoints, "switching away and back loses no rung");
  const other = L.withKindChoice({ kind: "conditional", on: "hitDice", breakpoints: [{ atLevel: 1, value: 1 }] }, { kind: "invocation" });
  assert.deepEqual(other.breakpoints, [], "another scale's rungs are not read as invocation levels");
  const flat = { kind: "flat", flat: 6 };
  assert.equal(L.withKindChoice(IMPORTED(), flat), flat, "any other choice passes through as it is");
});

await t("a figure left blank is null and stays null; zero is a figure, and what is not a number is flagged, never made one", () => {
  assert.equal(L.parseFigure(""), null);
  assert.equal(L.parseFigure("  "), null);
  assert.equal(L.parseFigure(undefined), null);
  assert.equal(L.parseFigure(null), null);
  assert.equal(L.parseFigure("0"), 0);
  assert.equal(L.parseFigure("4.5"), 4.5);
  assert.ok(Number.isNaN(L.parseFigure("two")));
  assert.ok(Number.isNaN(L.parseLevel("")), "a blank level is no level");
  assert.ok(Number.isNaN(L.parseLevel("2.5")), "a level is a whole number");
  assert.equal(L.parseLevel("4"), 4);
});

await t("a draft takes each rung with its mark, and a rung is added one level past the last", () => {
  const draft = L.draftOf(IMPORTED());
  assert.deepEqual(draft.map((r) => [r.at, r.value, r.hand]), [[1, 3, ""], [3, 5, ""], [5, 8, ""]]);
  assert.equal(new Set(draft.map((r) => r.id)).size, 3, "each rung has an identity of its own");
  const added = L.newRung(draft);
  assert.deepEqual([added.at, added.value, added.hand], [6, null, "added"]);
  assert.equal(L.newRung([]).at, 1, "the first rung is level 1");
  assert.deepEqual(L.draftOf({ kind: "flat", flat: 3 }), [], "no ladder, no rungs");
});

await t("an edit marks the rung, keeps what it replaced once, and drops the import's outcome and text with the old figure", () => {
  const draft = L.draftOf(ladder([2, 3, { outcome: "auto", text: "printed cell" }], [4, null, { outcome: "none" }]));
  const [first, second] = draft;
  L.editRung(first, { value: 6 });
  assert.deepEqual([first.hand, first.was, first.wasAt, first.value, first.outcome, first.text], ["edited", 3, 2, 6, "", ""]);
  L.editRung(first, { value: 7 });
  assert.deepEqual([first.was, first.wasAt, first.value], [3, 2, 7], "a second edit keeps the first baseline");
  L.editRung(second, { at: 5 });
  assert.deepEqual([second.hand, second.was, second.wasAt, second.at, second.outcome], ["edited", null, 4, 5, "none"], "a level change keeps the figure's outcome");
  const same = L.draftOf(IMPORTED())[0];
  L.editRung(same, { at: 1, value: 3 });
  assert.equal(same.hand, "", "an edit that changes nothing marks nothing");
});

await t("levels must be whole numbers and rise strictly: a blank, a duplicate and a descent each block, naming the rung", () => {
  const rungs = (...at) => L.draftOf(ladder(...at.map((a) => [a, 1])));
  assert.equal(L.validateRungs(rungs(1, 3, 5)), null);
  assert.equal(L.validateRungs([]), null, "an empty ladder is valid: nothing resolves from it");
  assert.deepEqual(L.validateRungs(rungs(1, 3, 3)), { key: "duplicate", data: { n: 3, level: 3 } });
  assert.deepEqual(L.validateRungs(rungs(1, 5, 3)), { key: "descending", data: { n: 3, level: 3, before: 5 } });
  const blank = rungs(1, 3);
  blank[1].at = L.parseLevel("");
  assert.deepEqual(L.validateRungs(blank), { key: "level", data: { n: 2 } });
  const frac = rungs(1, 3);
  frac[0].at = L.parseLevel("1.5");
  assert.equal(L.validateRungs(frac).key, "level");
  const text = rungs(1, 3);
  text[1].value = L.parseFigure("two");
  assert.deepEqual(L.validateRungs(text), { key: "figure", data: { n: 2 } });
  assert.deepEqual([...L.invalidRungs(rungs(1, 3, 3, 2))], [2, 3], "the boxes the error names");
});

await t("saving a draft writes the rungs as stored, keeps the stored value's own members, and refuses a draft that does not validate", () => {
  const base = { ...IMPORTED(), round: "up" };
  const draft = L.draftOf(base);
  L.editRung(draft[1], { value: 6 });
  draft.push(L.newRung(draft));
  const out = L.ladderOf(base, draft);
  assert.equal(out.round, "up");
  assert.equal(out.kind, "conditional");
  assert.equal(out.on, "invocationLevel");
  assert.deepEqual(out.breakpoints.map((b) => [b.atLevel, b.value, b.hand, b.was, b.wasAt]), [[1, 3, "", null, null], [3, 6, "edited", 5, 3], [5, 8, "", null, null], [6, null, "added", null, null]]);
  draft[3].at = 5;
  assert.throws(() => L.ladderOf(base, draft), /duplicate/);
});

await t("a blank figure resolves to no figure at its levels, never a number borrowed from a neighbour", () => {
  const draft = L.draftOf(IMPORTED());
  L.editRung(draft[1], { value: L.parseFigure("") });
  const out = L.ladderOf(IMPORTED(), draft);
  assert.equal(as(out, 3), null);
  assert.equal(as(out, 4), null, "between this rung and the next");
  assert.equal(as(out, 5), 8);
  assert.equal(as(out, 2), 3);
  assert.equal(as(out, 0), null, "below the first rung");
});

await t("an edited ladder resolves from its rungs, and an added or removed rung moves the figure at its levels", () => {
  const draft = L.draftOf(IMPORTED());
  L.editRung(draft[0], { value: 4 });
  draft.splice(2, 1);
  draft.push(L.newRung(draft));
  draft[2].at = 7;
  L.editRung(draft[2], { value: 9 });
  const out = L.ladderOf(IMPORTED(), draft);
  assert.deepEqual([1, 3, 5, 7].map((level) => as(out, level)), [4, 5, 5, 9]);
});

await t("restoring puts back every imported figure and level and drops the added rungs; a removed rung stays removed", () => {
  const draft = L.draftOf(IMPORTED());
  L.editRung(draft[0], { value: 99 });
  L.editRung(draft[1], { at: 4 });
  draft.push(L.newRung(draft));
  draft.splice(2, 1);
  assert.equal(L.hasHandWork(draft), true);
  const restored = L.restoreImported(draft);
  assert.deepEqual(restored.map((r) => [r.at, r.value, r.hand, r.was]), [[1, 3, "", null], [3, 5, "", null]]);
  assert.equal(L.hasHandWork(restored), false);
  assert.equal(L.hasHandWork(L.draftOf(L.ladderOf(IMPORTED(), L.draftOf(IMPORTED())))), false, "a save of an untouched draft marks nothing");
});

/* ------------------------------------------------------------------ */
/*  The draft holder                                                   */
/* ------------------------------------------------------------------ */

/** A holder over figures kept in one object, `{key: levelValue}`. */
function holder(held, editable = () => true) {
  return new L.RungDrafts({ read: (key) => held[key], editable });
}

await t("a draft is seeded from the stored ladder, survives every read, and leaves the stored value alone", () => {
  const held = { fig: IMPORTED() };
  const d = holder(held);
  const first = d.draft("fig");
  assert.equal(first.length, 3);
  assert.equal(d.change("fig", 1, { value: 6 }), true);
  assert.equal(d.draft("fig"), first, "the same draft comes back on every read, which is what lets it outlive a redraw");
  assert.equal(d.draft("fig")[1].value, 6);
  assert.deepEqual(held.fig, IMPORTED(), "nothing is stored until a save");
  assert.equal(d.dirty("fig"), true);
  assert.equal(d.dirty("other"), false);
});

await t("a draft nothing changed follows the stored ladder, and one a hand changed does not", () => {
  const held = { a: IMPORTED(), b: IMPORTED() };
  const d = holder(held);
  d.draft("a");
  d.change("b", 0, { value: 9 });
  held.a = ladder([1, 4]);
  held.b = ladder([1, 4]);
  assert.equal(d.draft("a").length, 1, "a clean draft re-seeds from what is stored now");
  assert.equal(d.draft("b").length, 3, "a changed draft is kept against a changed store");
  assert.equal(d.dirty("b"), true);
});

await t("add, remove, change and restore drive the draft; a removed rung is not brought back by restore", () => {
  const held = { fig: IMPORTED() };
  const d = holder(held);
  assert.equal(d.add("fig"), true);
  assert.deepEqual(d.draft("fig").map((r) => [r.at, r.hand]), [[1, ""], [3, ""], [5, ""], [6, "added"]]);
  d.change("fig", 0, { value: 99 });
  assert.equal(d.remove("fig", 1), true);
  assert.equal(d.remove("fig", 40), false, "no rung there");
  assert.equal(d.change("fig", 40, { value: 1 }), false);
  assert.deepEqual(d.draft("fig").map((r) => [r.at, r.value, r.hand]), [[1, 99, "edited"], [5, 8, ""], [6, null, "added"]]);
  assert.equal(d.restore("fig"), true);
  assert.deepEqual(d.draft("fig").map((r) => [r.at, r.value, r.hand]), [[1, 3, ""], [5, 8, ""]], "the edit is put back, the addition goes, and the removed rung stays removed");
});

await t("discard drops a draft so the next read starts from what is stored", () => {
  const held = { fig: IMPORTED() };
  const d = holder(held);
  d.add("fig");
  d.discard(["fig"]);
  assert.equal(d.draft("fig").length, 3);
  assert.equal(d.dirty("fig"), false);
});

await t("the verdict names the first figure that cannot be saved, and toSave returns only the figures a hand changed, refusing an invalid one", () => {
  const held = { value: IMPORTED(), max: ladder([2, 1], [4, 2]), idle: IMPORTED() };
  const d = holder(held);
  d.change("max", 1, { at: 2 });
  assert.deepEqual(d.verdict(["value", "max"]), { key: "duplicate", data: { n: 2, level: 2 }, field: "max" });
  assert.throws(() => d.toSave(["value", "max"]), /invalid: duplicate/);
  d.change("max", 1, { at: 7 });
  d.change("value", 0, { value: 11 });
  assert.equal(d.verdict(["value", "max", "idle"]), null);
  const out = d.toSave(["value", "max", "idle"]);
  assert.deepEqual(Object.keys(out), ["value", "max"], "the untouched figure is not written");
  assert.deepEqual(out.value.breakpoints.map((b) => [b.atLevel, b.value, b.hand]), [[1, 11, "edited"], [3, 5, ""], [5, 8, ""]]);
  assert.equal(out.max.kind, "conditional");
  assert.deepEqual(held.value, IMPORTED(), "toSave writes nothing itself");
});

await t("a viewer who may not edit changes nothing: every mutator refuses and toSave throws", () => {
  const held = { fig: IMPORTED() };
  const d = holder(held, () => false);
  assert.deepEqual([d.change("fig", 0, { value: 1 }), d.add("fig"), d.remove("fig", 0), d.restore("fig")], [false, false, false, false]);
  assert.deepEqual(d.draft("fig").map((r) => [r.at, r.value, r.hand]), [[1, 3, ""], [3, 5, ""], [5, 8, ""]]);
  assert.throws(() => d.toSave(["fig"]), /may not edit/);
});

/* ------------------------------------------------------------------ */
/*  What a window hands its templates                                  */
/* ------------------------------------------------------------------ */

await t("a ladder's context has a row per rung, marks the level boxes that block a save, and carries the page in the imported tooltip", () => {
  asGM(true);
  const d = holder({ fig: IMPORTED() });
  d.change("fig", 1, { at: 1 });
  d.change("fig", 2, { value: 10 });
  d.add("fig");
  const ctx = V.ladderContext(d, "fig", { group: "row", keys: ["fig"], cite: "Book p. 9", idBase: "win-1" });
  assert.deepEqual([ctx.key, ctx.group, ctx.keys, ctx.editable, ctx.empty, ctx.canRestore, ctx.errId], ["fig", "row", "fig", true, false, true, "win-1-row-error"]);
  assert.deepEqual(ctx.rungs.map((r) => [r.at, r.value, r.invalid, r.hand]), [["1", "3", false, ""], ["1", "5", true, "edited"], ["5", "10", false, "edited"], ["6", "", false, "added"]]);
  assert.match(ctx.rungs[0].tip, /tip\.imported.*"figure":"3".*tip\.cite.*Book p\. 9/s, "an imported figure names the row and the page");
  assert.match(ctx.rungs[2].tip, /tip\.edited.*tip\.was.*"figure":"8".*Book p\. 9/s, "an edited one names what it replaced");
  assert.equal(ctx.rungs[3].tip, "ACKS-LIB.rungEditor.tip.added");
  assert.match(ctx.rungs[2].valueLabel, /rung\.valueEdited/);
});

await t("an imported rung with no figure carries the page reference alone, and no page adds none", () => {
  const blank = { value: null, at: 2, hand: "", was: null, wasAt: null };
  assert.equal(V.rungTip(blank, "Book p. 9"), 'ACKS-LIB.rungEditor.tip.cite {"cite":"Book p. 9"}');
  assert.equal(V.rungTip(blank, ""), "");
  assert.match(V.rungTip({ value: 4, at: 2, hand: "edited", was: null, wasAt: null }, ""), /wasBlank/);
});

await t("the Save / Cancel context names the first fault in the footer and turns Save off, and a Player has no bar", () => {
  asGM(true);
  const d = holder({ fig: IMPORTED() });
  d.change("fig", 1, { at: 1 });
  const bar = V.actionsContext(d, { group: "row", keys: ["fig"], idBase: "w", saveLabel: "saveRow" });
  assert.deepEqual([bar.canSave, bar.editable, bar.keys, bar.saveLabel], [false, true, "fig", "ACKS-LIB.rungEditor.saveRow"]);
  assert.match(bar.error, /error\.duplicate.*"level":1/);
  d.change("fig", 1, { at: 2 });
  const fixed = V.actionsContext(d, { group: "row", keys: ["fig"], idBase: "w" });
  assert.deepEqual([fixed.canSave, fixed.error], [true, ""]);
  asGM(false);
  const player = V.actionsContext(holder({ fig: IMPORTED() }, V.isJudge), { group: "row", keys: ["fig"], idBase: "w" });
  assert.deepEqual([player.editable, player.canSave], [false, false]);
  asGM(true);
});

await t("the kind switch is a button group: the chosen kind pressed, By invocation level offered only to a spell, and a Player kept off the invocation scale", () => {
  asGM(true);
  const spell = V.kindContext("value", "Damage", IMPORTED(), { invocation: true, field: "value" });
  assert.deepEqual(spell.buttons.map((b) => [b.kind, b.pressed, b.disabled]), [["flat", false, false], ["perLevel", false, false], ["invocation", true, false]]);
  assert.equal(spell.choice, "invocation");
  assert.equal(V.kindContext("value", "Damage", { kind: "flat", flat: 2 }, { invocation: true }).choice, "flat");
  assert.equal(V.kindContext("value", "Damage", 4, { invocation: true }).choice, "flat");
  const ability = V.kindContext("value", "Bonus", { kind: "perLevel" }, { invocation: false });
  assert.deepEqual(ability.buttons.map((b) => b.kind), ["flat", "perLevel"]);
  assert.equal(ability.choice, "perLevel");
  assert.equal(V.kindContext("value", "Bonus", IMPORTED(), { invocation: false }).choice, "conditional", "an ability row holding the ladder keeps the kind it is stored under");
  asGM(false);
  const onLadder = V.kindContext("value", "Damage", IMPORTED(), { invocation: true });
  assert.deepEqual(onLadder.buttons.map((b) => b.disabled), [true, true, true], "a Player may not move a figure off the ladder");
  const flatPlayer = V.kindContext("value", "Damage", { kind: "flat", flat: 1 }, { invocation: true });
  assert.deepEqual(flatPlayer.buttons.map((b) => b.disabled), [false, false, true], "nor onto it, but may still choose between the others");
  assert.equal(V.kindAllowed({ kind: "flat" }, "invocation"), false);
  asGM(true);
  assert.equal(V.kindAllowed({ kind: "flat" }, "invocation"), true);
});

await t("choosing By invocation level writes the conditional, and re-submitting it keeps the rungs", () => {
  const flat = { type: "damage", value: { kind: "flat", flat: 2 }, origin: "register" };
  const switched = mergeRowEdit(flat, { value: { kind: "invocation" } });
  assert.deepEqual([switched.value.kind, switched.value.on, switched.value.breakpoints], ["conditional", "invocationLevel", []]);
  assert.equal(switched.value.flat, 2, "the flat figure the Judge had stays for a switch back");
  assert.equal(switched.origin, "");
  const laddered = { type: "damage", value: IMPORTED() };
  const again = mergeRowEdit(laddered, { value: { kind: "invocation" }, note: "kept" });
  assert.deepEqual(again.value.breakpoints, IMPORTED().breakpoints, "a change to another field re-submits the choice and costs no rung");
  const back = mergeRowEdit(laddered, { value: { kind: "flat" } });
  assert.equal(back.value.kind, "flat");
  assert.deepEqual(back.value.breakpoints, IMPORTED().breakpoints, "switching away keeps the rungs");
});

/* ------------------------------------------------------------------ */
/*  The listeners and the in-place painting                            */
/* ------------------------------------------------------------------ */

/** A stand-in node: a dataset, attributes, a class set, listeners, and the descendants each selector finds. */
function node({ dataset = {}, matches = [], found = {} } = {}) {
  const listeners = {};
  const self = {
    nodeType: 1,
    dataset,
    attrs: {},
    classes: new Set(),
    value: "",
    hidden: false,
    disabled: false,
    textContent: "",
    validity: {},
    matches: (sel) => matches.includes(sel),
    setAttribute(k, v) {
      self.attrs[k] = String(v);
    },
    removeAttribute(k) {
      delete self.attrs[k];
    },
    classList: { toggle: (c, on) => (on ? self.classes.add(c) : self.classes.delete(c)) },
    querySelectorAll: (sel) => found[sel] ?? [],
    querySelector: (sel) => (found[sel] ?? [])[0] ?? null,
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    listenerCount: (type) => (listeners[type] ?? []).length,
    parent: null,
    listeners,
    /** Fire an event at this node and bubble it up through its parents until a listener stops it. */
    fire(type, extra = {}) {
      const event = { target: self, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...extra };
      for (let at = self; at && !event.stopped; at = at.parent) for (const fn of at.listeners[type] ?? []) fn(event);
      return event;
    },
  };
  return self;
}

/** A window's DOM for one ladder: its level and figure boxes, Restore, and a Save / Cancel bar. */
function ladderDom(count = 3) {
  const ats = Array.from({ length: count }, (_, i) => node({ dataset: { rungAt: String(i) }, matches: ["[data-rung-at]"] }));
  const figures = Array.from({ length: count }, (_, i) => node({ dataset: { rungValue: String(i) }, matches: ["[data-rung-value]"] }));
  const restore = node();
  const box = node({
    dataset: { rungLadder: "fig", rungGroup: "row", rungKeys: "fig" },
    found: { "[data-rung-at]": ats, '[data-action="rungRestore"]': [restore], ...Object.fromEntries(figures.map((f, i) => [`[data-rung-value="${i}"]`, [f]])) },
  });
  for (const child of [...ats, ...figures]) child.parent = box;
  const text = node();
  const icon = node();
  const save = node();
  const state = node();
  state.id = "w-row-error";
  const bar = node({ dataset: { rungGroup: "row" }, found: { "[data-rung-state]": [state], "[data-rung-state-text]": [text], "[data-rung-state-icon]": [icon], '[data-action="rungSave"]': [save] } });
  const element = node({ found: { "[data-rung-ladder]": [box], "[data-rung-actions]": [bar] } });
  return { ats, figures, restore, box, text, icon, save, element };
}

await t("a typed rung updates the draft and repaints in place: the level mark, the edited mark and tooltip, Restore, and the footer's verdict and Save", () => {
  asGM(true);
  const dom = ladderDom();
  const host = { element: dom.element, rungs: holder({ fig: IMPORTED() }), rungCite: () => "Book p. 9" };
  V.wireRungs(host);
  dom.ats[1].value = "1";
  const typed = dom.ats[1].fire("input");
  assert.equal(typed.stopped, false, "a typed rung is not stopped; only its change is");
  assert.equal(host.rungs.draft("fig")[1].at, 1, "the draft took it");
  assert.equal(dom.ats[1].attrs["aria-invalid"], "true", "the duplicate level box is marked");
  assert.equal(dom.ats[0].attrs["aria-invalid"], undefined);
  assert.equal(dom.save.attrs["aria-disabled"], "true");
  assert.equal(dom.save.attrs["aria-describedby"], "w-row-error", "Save points at the verdict once it has one, as the template draws it");
  assert.equal(dom.ats[1].attrs["aria-describedby"], "w-row-error", "and so does the marked level box");
  assert.equal(dom.ats[0].attrs["aria-describedby"], undefined);
  assert.equal(dom.save.classes.has("is-disabled"), true);
  assert.match(dom.text.textContent, /error\.duplicate.*"level":1/);
  assert.equal(dom.icon.hidden, false);
  dom.ats[1].value = "4";
  dom.ats[1].fire("input");
  assert.equal(dom.ats[1].attrs["aria-invalid"], undefined, "the mark clears");
  assert.equal(dom.save.attrs["aria-disabled"], undefined, "Save is back on");
  assert.equal(dom.save.attrs["aria-describedby"], undefined, "and points at nothing");
  assert.equal(dom.ats[1].attrs["aria-describedby"], undefined);
  assert.equal(dom.text.textContent, "");
  assert.equal(dom.icon.hidden, true);
  dom.figures[2].value = "10";
  dom.figures[2].fire("input");
  assert.equal(host.rungs.draft("fig")[2].value, 10);
  assert.equal(dom.figures[2].classes.has("is-edited"), true, "the gold edge");
  assert.match(dom.figures[2].attrs["data-tooltip-text"], /tip\.edited.*tip\.was.*"figure":"8".*Book p\. 9/s);
  assert.equal(dom.restore.disabled, false, "Restore has something to do");
  dom.figures[2].value = "";
  dom.figures[2].fire("input");
  assert.equal(host.rungs.draft("fig")[2].value, null, "a blank figure is null, never a number");
});

await t("a rung box's change event is stopped below the form, Enter is kept from submitting it, and a ladder is wired once", () => {
  asGM(true);
  const dom = ladderDom();
  const host = { element: dom.element, rungs: holder({ fig: IMPORTED() }), rungCite: () => "" };
  V.wireRungs(host);
  V.wireRungs(host);
  assert.deepEqual([dom.box.listenerCount("input"), dom.box.listenerCount("change"), dom.box.listenerCount("keydown")], [1, 1, 1], "a second render wires nothing again");
  assert.equal(dom.ats[0].fire("change").stopped, true, "the form never hears it, so it never submits");
  assert.equal(dom.ats[0].fire("keydown", { key: "Enter" }).prevented, true);
  assert.equal(dom.ats[0].fire("keydown", { key: "a" }).prevented, false);
});

await t("a bad number in a box is no figure and blocks the save; a Player's typing reaches nothing", () => {
  asGM(true);
  const dom = ladderDom();
  const host = { element: dom.element, rungs: holder({ fig: IMPORTED() }), rungCite: () => "" };
  V.wireRungs(host);
  dom.figures[0].value = "";
  dom.figures[0].validity = { badInput: true };
  dom.figures[0].fire("input");
  assert.ok(Number.isNaN(host.rungs.draft("fig")[0].value), "bad input is flagged, not blanked");
  assert.match(dom.text.textContent, /error\.figure/);
  asGM(false);
  const playerDom = ladderDom();
  const player = { element: playerDom.element, rungs: holder({ fig: IMPORTED() }, V.isJudge), rungCite: () => "" };
  V.wireRungs(player);
  playerDom.ats[0].value = "7";
  playerDom.ats[0].fire("input");
  assert.equal(player.rungs.draft("fig")[0].at, 1, "the draft is as stored");
  assert.equal(playerDom.text.textContent, "", "and nothing repaints");
  asGM(true);
});

/* ------------------------------------------------------------------ */
/*  The effect-row editor                                              */
/* ------------------------------------------------------------------ */

const rowActions = EffectRowEditor.DEFAULT_OPTIONS.actions;
const keys = (...names) => ({ dataset: { rungKeys: names.join(" ") } });

/** A row editor over rows kept in one object, recording every write the store receives. */
function rowEditor(rows, { domain = "spell", index = 0 } = {}) {
  const writes = [];
  const store = {
    key: "spell:fx",
    label: "Invented Spell",
    domain,
    cite: () => "Book p. 9",
    read: () => structuredClone(rows.current),
    write: async (next) => {
      writes.push(structuredClone(next));
      rows.current = structuredClone(next);
      return next;
    },
  };
  return { editor: new EffectRowEditor({ store, index }), store, writes };
}
const fieldOf = (ctx, name) => ctx.fields.find((f) => f.name === name);

await t("a row on the invocation scale shows the button group on it, the rungs inline and the pinned footer; any other kind opens as before", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "damage", value: IMPORTED() }] };
  const { editor } = rowEditor(rows);
  const ctx = await editor._prepareContext({});
  const value = fieldOf(ctx, "value");
  assert.deepEqual([value.isInvocation, value.kindGroup.choice, value.ladder.rungs.length, value.ladder.keys], [true, "invocation", 3, "value"]);
  assert.deepEqual(value.kindGroup.buttons.map((b) => [b.kind, b.pressed]), [["flat", false], ["perLevel", false], ["invocation", true]]);
  assert.match(value.ladder.rungs[0].tip, /Book p\. 9/, "the store's page rides the imported figure's tooltip");
  assert.deepEqual([ctx.footer.show, ctx.footer.keys, ctx.footer.canSave], [true, "value", true]);
  const flat = fieldOf(await rowEditor({ current: [{ type: "damage", value: { kind: "flat", flat: 2 } }] }).editor._prepareContext({}), "value");
  assert.deepEqual([flat.isInvocation, flat.kindGroup.choice, flat.isFlat, flat.ladder], [false, "flat", true, undefined]);
  const plain = await rowEditor({ current: [{ type: "damage", value: { kind: "flat", flat: 2 } }] }).editor._prepareContext({});
  assert.equal(plain.footer.show, false, "a row with no ladder carries no footer");
  const other = fieldOf(await rowEditor({ current: [{ type: "damage", value: { kind: "conditional", on: "hitDice", breakpoints: [] } }] }).editor._prepareContext({}), "value");
  assert.deepEqual([other.isInvocation, other.kindGroup.choice], [false, "conditional"]);
  const ability = await rowEditor({ current: [{ type: "modifier", value: IMPORTED() }] }, { domain: "ability" }).editor._prepareContext({});
  assert.deepEqual([fieldOf(ability, "value").isInvocation, fieldOf(ability, "value").kindGroup.choice, ability.footer.show], [false, "conditional", false], "an ability has no invocation level to key on");
  assert.deepEqual(fieldOf(ability, "value").kindGroup.buttons.map((b) => b.kind), ["flat", "perLevel"]);
});

await t("a Player sees the ladder read-only: no footer, the kind buttons off, and no write ever reaches the store", async () => {
  asGM(false);
  const rows = { current: [{ key: "a", type: "damage", value: IMPORTED() }] };
  const { editor, writes } = rowEditor(rows);
  const ctx = await editor._prepareContext({});
  const value = fieldOf(ctx, "value");
  assert.deepEqual([ctx.footer.show, value.ladder.editable, value.ladder.canRestore], [false, false, false]);
  assert.ok(value.kindGroup.buttons.every((b) => b.disabled));
  rowActions.rungAdd.call(editor, null, { dataset: { rungKey: "value" } });
  rowActions.rungRemove.call(editor, null, { dataset: { rungKey: "value", index: "0" } });
  rowActions.rungRestore.call(editor, null, { dataset: { rungKey: "value" } });
  await rowActions.rungSave.call(editor, null, keys("value"));
  await rowActions.figureKind.call(editor, null, { dataset: { field: "value", kind: "flat" } });
  await rowActions.figureKind.call(editor, null, { dataset: { field: "value", kind: "invocation" } });
  assert.deepEqual(writes, [], "nothing was written");
  assert.equal(editor.renders, 0, "and nothing was redrawn");
  assert.equal(editor.rungs.draft("value").length, 3);
  asGM(true);
});

await t("add, remove and change draft the rungs with no write, and a redraw by another field's write keeps the draft", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "damage", value: IMPORTED(), note: "kept" }] };
  const { editor, writes } = rowEditor(rows);
  rowActions.rungAdd.call(editor, null, { dataset: { rungKey: "value" } });
  assert.equal(editor.renders, 1, "the window redraws to show the new rung");
  editor.rungs.change("value", 0, { value: 12 });
  rowActions.rungRemove.call(editor, null, { dataset: { rungKey: "value", index: "1" } });
  assert.deepEqual(writes, [], "no write while the rungs are a draft");
  assert.deepEqual(rows.current[0].value, IMPORTED(), "and the stored ladder is as imported");
  // Another field of the window changes: core's submit-on-change writes the row and redraws.
  await EffectRowEditor.DEFAULT_OPTIONS.form.handler.call(editor);
  assert.equal(writes.length, 1, "every other field keeps writing on change");
  assert.deepEqual(writes[0][0].value.breakpoints.map((b) => b.value), [3, 5, 8], "and the write carries the stored rungs, never the draft");
  const ctx = await editor._prepareContext({});
  assert.deepEqual(fieldOf(ctx, "value").ladder.rungs.map((r) => [r.at, r.value, r.hand]), [["1", "12", "edited"], ["5", "8", ""], ["6", "", "added"]], "the draft survived the redraw");
});

await t("Save row validates, writes the row once with the by-hand marks, makes the row the Judge's, and drops the draft", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "damage", origin: "register", value: IMPORTED(), note: "kept" }] };
  const { editor, writes } = rowEditor(rows);
  editor.rungs.change("value", 2, { value: 10 });
  rowActions.rungAdd.call(editor, null, { dataset: { rungKey: "value" } });
  editor.rungs.change("value", 3, { value: 2 });
  const before = editor.renders;
  await rowActions.rungSave.call(editor, null, keys("value"));
  assert.equal(writes.length, 1, "one write");
  const [row] = writes[0];
  assert.equal(row.origin, "");
  assert.equal(row.note, "kept");
  assert.deepEqual(row.value.breakpoints.map((b) => [b.atLevel, b.value, b.hand, b.was]), [[1, 3, "", null], [3, 5, "", null], [5, 10, "edited", 8], [6, 2, "added", null]]);
  assert.equal(editor.rungs.dirty("value"), false, "the draft is gone");
  assert.equal(editor.renders, before + 1, "and the window redraws from what was written");
  assert.equal(as(row.value, 6), 2, "the saved ladder resolves from its rungs");
  await rowActions.rungSave.call(editor, null, keys("value"));
  assert.equal(writes.length, 1, "Save with nothing changed writes nothing");
});

await t("an invalid draft is never written: Save refuses, the footer names why, and Cancel puts the stored ladder back", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "damage", value: IMPORTED() }] };
  const { editor, writes } = rowEditor(rows);
  editor.rungs.change("value", 1, { at: 1 });
  const ctx = await editor._prepareContext({});
  assert.equal(ctx.footer.canSave, false);
  assert.match(ctx.footer.error, /error\.duplicate/);
  await rowActions.rungSave.call(editor, null, keys("value"));
  assert.deepEqual(writes, []);
  assert.equal(editor.rungs.dirty("value"), true, "the draft stays so it can be fixed");
  rowActions.rungCancel.call(editor, null, keys("value"));
  assert.equal(editor.rungs.dirty("value"), false);
  assert.deepEqual((await editor._prepareContext({})).footer.error, "");
  assert.deepEqual(writes, [], "Cancel writes nothing either");
});

await t("a row with a figure and a ceiling both on ladders saves both in one write, and an invalid one blocks both", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "damage", value: IMPORTED(), max: ladder([1, 2], [4, 3]) }] };
  const { editor, writes } = rowEditor(rows);
  const ctx = await editor._prepareContext({});
  assert.equal(ctx.footer.keys, "value max");
  assert.equal(fieldOf(ctx, "max").ladder.keys, "value max", "each ladder saves with the row's one footer");
  editor.rungs.change("value", 0, { value: 4 });
  editor.rungs.change("max", 1, { value: 9 });
  editor.rungs.change("max", 1, { at: 1 });
  await rowActions.rungSave.call(editor, null, keys("value", "max"));
  assert.deepEqual(writes, [], "the ceiling's fault holds the figure's save back too");
  editor.rungs.change("max", 1, { at: 6 });
  await rowActions.rungSave.call(editor, null, keys("value", "max"));
  assert.equal(writes.length, 1);
  assert.deepEqual([writes[0][0].value.breakpoints[0].value, writes[0][0].max.breakpoints[1].value, writes[0][0].max.breakpoints[1].atLevel], [4, 9, 6]);
});

await t("the kind buttons apply at once: onto the ladder writes it, off it keeps the rungs and drops the draft, and a Player is refused", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "damage", value: { kind: "flat", flat: 2 } }] };
  const { editor, writes } = rowEditor(rows);
  await rowActions.figureKind.call(editor, null, { dataset: { field: "value", kind: "invocation" } });
  assert.deepEqual([writes.length, rows.current[0].value.kind, rows.current[0].value.on, rows.current[0].value.breakpoints], [1, "conditional", "invocationLevel", []]);
  assert.equal(rows.current[0].value.flat, 2, "the flat figure is still there for a switch back");
  rows.current[0].value = IMPORTED();
  rowActions.rungAdd.call(editor, null, { dataset: { rungKey: "value" } });
  assert.equal(editor.rungs.dirty("value"), true);
  await rowActions.figureKind.call(editor, null, { dataset: { field: "value", kind: "perLevel" } });
  assert.equal(editor.rungs.dirty("value"), false, "switching away drops the draft");
  assert.deepEqual(rows.current[0].value.breakpoints, IMPORTED().breakpoints, "but keeps the stored rungs for a switch back");
  assert.equal(rows.current[0].value.kind, "perLevel");
  const before = writes.length;
  await rowActions.figureKind.call(editor, null, { dataset: { field: "nonsense", kind: "flat" } });
  assert.equal(writes.length, before, "a field that is no level value is refused");
});

await t("deleting or moving a row closes the open editors of its store and leaves another store's alone", async () => {
  const mk = (key) => {
    const editor = new EffectRowEditor({ store: { key, label: "x", domain: "spell", read: () => [{}] }, index: 0 });
    instances.set(editor.id + key, editor);
    editor.id = key;
    return editor;
  };
  const mine = mk("s:1");
  const other = mk("s:2");
  await closeEffectEditors({ key: "s:1" });
  assert.deepEqual([mine.closed, other.closed], [true, false]);
  instances.clear();
});

/* ------------------------------------------------------------------ */
/*  The spell overview                                                 */
/* ------------------------------------------------------------------ */

const { default: SpellExtras } = await import("../scripts/magic/spell-extras.mjs");
SpellExtras.fromSource = (data) => ({ toObject: () => data });
const sheet = await import("../scripts/magic/spell-sheet.mjs");
const spellItem = (flag, system = { lvl: "1", class: "Invented", range: "10", duration: "1", save: "S" }) => {
  const item = {
    uuid: "Item.invented",
    name: "Invented Spell",
    system,
    flags: { "acks-extras": { spell: flag } },
    getFlag: (scope, key) => item.flags[scope]?.[key],
    updates: [],
    update: async (data) => {
      item.updates.push(data);
      for (const [path, value] of Object.entries(data)) setProperty(item, path, value);
    },
  };
  return item;
};
const Sheet = sheet.createSpellSheet(
  class {
    static PARTS = {};
    submits = 0;
    get item() {
      return this._item;
    }
    render(arg) {
      this.lastRender = arg;
    }
    async submit() {
      this.submits++;
    }
    async _prepareContext() {
      return {};
    }
    async _onRender() {}
    _prepareSubmitData(event, form, formData) {
      return formData;
    }
  },
);
const sheetOf = (item) => Object.assign(new Sheet(), { _item: item, id: "sheet-1" });
const sheetActions = Sheet.DEFAULT_OPTIONS.actions;
const COUNT = "target.count";

await t("the overview's figures are the eight level values, each with a path its draft is keyed by", () => {
  assert.deepEqual([...sheet.LEVEL_VALUE_PATHS], ["target.count", "target.hdPool", "target.area.size", "target.area.width", "save.modifier", "target.hdCap", "target.hdBelow", "save.exemptBelowHd"]);
});

await t("an overview figure on the invocation scale shows the button group, its rungs and its own bar; the others show their own controls", async () => {
  asGM(true);
  const view = sheetOf(spellItem({ cite: "Book p. 9", target: { model: "creature", count: IMPORTED(), hdCap: { kind: "flat", flat: 4 } } }));
  const ctx = await view._prepareContext({});
  const count = ctx.levelValues.count;
  assert.deepEqual([count.isInvocation, count.kindGroup.choice, count.path, count.name], [true, "invocation", COUNT, "flags.acks-extras.spell.target.count"]);
  assert.deepEqual([count.ladder.rungs.length, count.ladder.keys, count.ladderActions.keys, count.ladderActions.canSave], [3, COUNT, COUNT, true]);
  assert.match(count.ladder.rungs[0].tip, /Book p\. 9/, "the figure's page reference is kept");
  assert.equal(count.ladderActions.saveLabel, "ACKS-LIB.rungEditor.saveRungs");
  const hdCap = ctx.levelValues.hdCap;
  assert.deepEqual([hdCap.isInvocation, hdCap.isFlat, hdCap.ladder, hdCap.ladderActions, hdCap.kindGroup.choice], [false, true, null, null, "flat"]);
  asGM(false);
  const player = (await sheetOf(spellItem({ target: { count: IMPORTED() } }))._prepareContext({})).levelValues.count;
  assert.deepEqual([player.ladder.editable, player.ladderActions.editable, player.kindGroup.buttons.every((b) => b.disabled)], [false, false, true]);
  asGM(true);
});

await t("overview rungs are drafted: no write on add, remove or change, and the draft survives the sheet's redraws and its own submit", async () => {
  asGM(true);
  const item = spellItem({ target: { model: "creature", count: IMPORTED() } });
  const view = sheetOf(item);
  sheetActions.rungAdd.call(view, null, { dataset: { rungKey: COUNT } });
  assert.deepEqual(view.lastRender, { parts: ["overview"] }, "only the overview redraws");
  view.rungs.change(COUNT, 0, { value: 12 });
  sheetActions.rungRemove.call(view, null, { dataset: { rungKey: COUNT, index: "1" } });
  assert.deepEqual(item.updates, [], "nothing is written");
  // The sheet re-renders on every submit of another field, and rebuilds its context each time.
  await view._prepareContext({});
  const again = (await view._prepareContext({})).levelValues.count.ladder;
  assert.deepEqual(again.rungs.map((r) => [r.at, r.value, r.hand]), [["1", "12", "edited"], ["5", "8", ""], ["6", "", "added"]]);
  const out = view._prepareSubmitData(null, null, { flags: { "acks-extras": { spell: { target: { count: { kind: "invocation" } } } } } }, {});
  assert.deepEqual(out.flags["acks-extras"].spell.target.count.breakpoints, IMPORTED().breakpoints, "the sheet's own submit carries the stored rungs, never the draft");
});

await t("Save writes the figure's flag path once through the spell's normalisation, with the by-hand marks, and drops the draft", async () => {
  asGM(true);
  const item = spellItem({ target: { model: "creature", count: IMPORTED() } });
  const view = sheetOf(item);
  view.rungs.change(COUNT, 1, { value: 6 });
  await sheetActions.rungSave.call(view, null, keys(COUNT));
  assert.equal(item.updates.length, 1, "one update");
  const [update] = item.updates;
  const written = update["flags.acks-extras.spell.target.count"];
  assert.deepEqual(written.breakpoints.map((b) => [b.atLevel, b.value, b.hand, b.was]), [[1, 3, "", null], [3, 6, "edited", 5], [5, 8, "", null]]);
  assert.equal(written.on, "invocationLevel");
  assert.ok(!Object.keys(update).some((key) => key.startsWith("flags.acks-extras.spell.effects")), "no row is touched");
  assert.equal(view.rungs.dirty(COUNT), false);
  assert.equal(sheet.spellFigureStore(item).cite(), undefined);
  assert.deepEqual(sheet.spellFigureStore(item).read(COUNT).breakpoints.map((b) => b.hand), ["", "edited", ""], "the store reads back what was saved");
});

await t("an invalid overview draft is never written, Cancel drops it, and a Player's save writes nothing", async () => {
  asGM(true);
  const item = spellItem({ target: { count: IMPORTED() } });
  const view = sheetOf(item);
  view.rungs.change(COUNT, 2, { at: 3 });
  await sheetActions.rungSave.call(view, null, keys(COUNT));
  assert.deepEqual(item.updates, []);
  assert.match((await view._prepareContext({})).levelValues.count.ladderActions.error, /error\.duplicate/);
  sheetActions.rungCancel.call(view, null, keys(COUNT));
  assert.equal(view.rungs.dirty(COUNT), false);
  assert.deepEqual(item.updates, [], "Cancel writes nothing");
  view.rungs.change(COUNT, 0, { value: 1 });
  asGM(false);
  await sheetActions.rungSave.call(view, null, keys(COUNT));
  assert.deepEqual(item.updates, [], "a Player's save is closed");
  asGM(true);
});

await t("two overview figures are drafted and saved apart", async () => {
  asGM(true);
  const item = spellItem({ target: { model: "creature", count: IMPORTED(), hdPool: ladder([1, 2], [4, 6]) } });
  const view = sheetOf(item);
  view.rungs.change(COUNT, 0, { value: 9 });
  view.rungs.change("target.hdPool", 1, { value: 7 });
  await sheetActions.rungSave.call(view, null, keys("target.hdPool"));
  assert.equal(item.updates.length, 1);
  assert.ok("flags.acks-extras.spell.target.hdPool" in item.updates[0]);
  assert.equal(view.rungs.dirty(COUNT), true, "the other figure's draft is untouched");
  assert.equal(view.rungs.dirty("target.hdPool"), false);
});

await t("an overview kind button sets the figure's kind input and submits the sheet, dropping the draft; a Player and a stray path are refused", async () => {
  asGM(true);
  const item = spellItem({ target: { model: "creature", count: IMPORTED(), hdCap: { kind: "flat", flat: 2 } } });
  const view = sheetOf(item);
  const input = { value: "flat" };
  const figure = (path) => ({ dataset: { figure: path }, querySelector: (sel) => (sel === "input[data-kind-input]" ? input : null) });
  const button = (path, kind) => ({ dataset: { kind }, closest: () => figure(path) });
  view.rungs.add(COUNT);
  await sheetActions.figureKind.call(view, null, button(COUNT, "perLevel"));
  assert.deepEqual([input.value, view.submits, view.rungs.dirty(COUNT)], ["perLevel", 1, false]);
  await sheetActions.figureKind.call(view, null, button("effects.0.value", "flat"));
  assert.equal(view.submits, 1, "a path that is no overview figure is refused");
  asGM(false);
  await sheetActions.figureKind.call(view, null, button("target.hdCap", "invocation"));
  await sheetActions.figureKind.call(view, null, button(COUNT, "flat"));
  assert.equal(view.submits, 1, "a Player may not move a figure on or off the ladder");
  await sheetActions.figureKind.call(view, null, button("target.hdCap", "perLevel"));
  assert.equal(view.submits, 2, "but may still switch between the other kinds");
  asGM(true);
});

await t("the overview's kind switch is converted on submit: By invocation level becomes the stored ladder, keeping its rungs", () => {
  const flag = { target: { model: "creature", count: IMPORTED(), hdCap: { kind: "flat", flat: 2 } } };
  const view = sheetOf(spellItem(flag));
  const submit = (fragment) => view._prepareSubmitData(null, null, { flags: { "acks-extras": { spell: fragment } } }, {});
  const out = submit({ target: { count: { kind: "invocation" }, hdCap: { kind: "invocation" } } });
  const result = out.flags["acks-extras"].spell.target;
  assert.deepEqual(result.count.breakpoints, IMPORTED().breakpoints, "an invocation figure re-submitted on another field's change keeps its rungs");
  assert.deepEqual([result.hdCap.kind, result.hdCap.on, result.hdCap.breakpoints], ["conditional", "invocationLevel", []], "a flat figure switched over starts empty");
  assert.equal(result.hdCap.flat, 2, "and keeps its flat figure for a switch back");
});

/* ------------------------------------------------------------------ */
/*  The templates, rendered offline                                    */
/* ------------------------------------------------------------------ */

Handlebars.registerHelper("localize", (key) => key);
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("selectOptions", (choices, { hash }) =>
  new Handlebars.SafeString(Object.entries(choices).map(([key, label]) => `<option value="${key}"${key === hash.selected ? " selected" : ""}>${label}</option>`).join("")));
Handlebars.registerHelper("checked", (v) => (v ? "checked" : ""));
const TEMPLATES = ["lib/rung-ladder", "lib/rung-actions", "lib/figure-kind", "lib/rung-footer", "lib/effect-row-editor", "magic/level-value"];
for (const name of TEMPLATES) Handlebars.registerPartial(`modules/acks-extras/templates/${name}.hbs`, read(`templates/${name}.hbs`));
const render = (name, context) => Handlebars.compile(read(`templates/${name}.hbs`))(context);

await t("the rungs render a box per level and figure with no form name, a gold edge and tooltip on an edited one, and a remove control per rung", () => {
  asGM(true);
  const d = holder({ fig: IMPORTED() });
  d.change("fig", 1, { value: 6 });
  const html = render("lib/rung-ladder", V.ladderContext(d, "fig", { group: "row", keys: ["fig"], cite: "Book p. 9", idBase: "w" }));
  assert.equal((html.match(/data-rung-at="/g) ?? []).length, 3);
  assert.equal((html.match(/data-rung-value="/g) ?? []).length, 3);
  assert.equal((html.match(/data-action="rungRemove"/g) ?? []).length, 3);
  assert.ok(!/\sname=/.test(html), "no rung box is a form field, so the form's submit never reads one");
  assert.match(html, /class="acks-input is-edited"[^>]*data-rung-value="1"/);
  assert.match(html, /data-rung-ladder="fig" data-rung-group="row" data-rung-keys="fig"/);
  assert.match(html, /data-action="rungAdd" data-rung-key="fig"/);
  assert.match(html, /data-action="rungRestore"[^>]*>/);
  assert.ok(!/data-action="rungRestore"[^>]*disabled/.test(html), "Restore is on once a hand changed a rung");
});

await t("an invalid draft marks its level box and Save points at the footer's verdict; an empty ladder says so; a Player gets read-only boxes and no buttons", () => {
  asGM(true);
  const d = holder({ fig: IMPORTED() });
  d.change("fig", 1, { at: 1 });
  const html = render("lib/rung-ladder", V.ladderContext(d, "fig", { group: "row", keys: ["fig"], idBase: "w" }));
  assert.match(html, /data-rung-at="1"[^>]*aria-invalid="true" aria-describedby="w-row-error"/);
  const bar = render("lib/rung-actions", V.actionsContext(d, { group: "row", keys: ["fig"], idBase: "w", saveLabel: "saveRow" }));
  assert.match(bar, /id="w-row-error"/);
  assert.match(bar, /data-action="rungSave" data-rung-keys="fig" aria-disabled="true" aria-describedby="w-row-error"/);
  assert.match(bar, /error\.duplicate/);
  assert.match(bar, /Save row|rungEditor\.saveRow/);
  assert.match(bar, /data-action="rungCancel" data-rung-keys="fig"/);
  const empty = render("lib/rung-ladder", V.ladderContext(holder({ fig: ladder() }), "fig", { group: "row", keys: ["fig"], idBase: "w" }));
  assert.match(empty, /rungEditor\.empty/);
  assert.match(empty, /data-action="rungAdd"/, "an empty ladder still offers Add");
  asGM(false);
  const player = render("lib/rung-ladder", V.ladderContext(holder({ fig: IMPORTED() }, V.isJudge), "fig", { group: "row", keys: ["fig"], idBase: "w" }));
  assert.equal((player.match(/readonly/g) ?? []).length, 6);
  assert.ok(!/data-action="rung(Add|Remove|Restore)"/.test(player), "no write control is drawn");
  asGM(true);
});

await t("the kind switch renders a pressed group with the form's hidden kind beside it, and the pinned footer is hidden for a ladder-less row and a Player", () => {
  asGM(true);
  const group = render("lib/figure-kind", V.kindContext("value", "Damage", IMPORTED(), { invocation: true, field: "value" }));
  assert.match(group, /<input type="hidden" name="value\.kind" value="invocation" data-kind-input>/);
  assert.equal((group.match(/aria-pressed="/g) ?? []).length, 3);
  assert.match(group, /data-kind="invocation"[^>]*data-field="value" aria-pressed="true"/);
  assert.match(group, /data-kind="flat"[^>]*aria-pressed="false"/);
  const on = render("lib/rung-footer", { footer: { show: true, ...V.actionsContext(holder({ fig: IMPORTED() }), { group: "row", keys: ["fig"], idBase: "w", saveLabel: "saveRow" }) } });
  assert.ok(!/<footer[^>]*hidden/.test(on));
  assert.match(on, /data-action="rungSave"/);
  const off = render("lib/rung-footer", { footer: { show: false } });
  assert.match(off, /<footer[^>]*hidden>/);
  assert.ok(!/data-action/.test(off));
});

await t("the row window renders the figure's button group, the ladder inline and no Save in its body; a flat figure renders its box", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "damage", value: IMPORTED() }, { key: "b", type: "damage", value: { kind: "flat", flat: 2 } }] };
  const body = async (index) => render("lib/effect-row-editor", { ...(await rowEditor(rows, { index }).editor._prepareContext({})), partId: "p" });
  const html = await body(0);
  assert.match(html, /data-rung-ladder="value"/);
  assert.match(html, /name="value\.kind" value="invocation"/);
  assert.ok(!/rungSave/.test(html), "Save row is the footer part's, below the scroller");
  const flat = await body(1);
  assert.ok(!/data-rung-ladder/.test(flat));
  assert.match(flat, /name="value\.flat" value="2"/);
});

await t("the overview's figure partial renders the group and, for a ladder, the rungs with their own bar; a flat figure its box", async () => {
  asGM(true);
  const ctx = (await sheetOf(spellItem({ target: { model: "creature", count: IMPORTED(), hdCap: { kind: "flat", flat: 4 } } }))._prepareContext({})).levelValues;
  const ladderHtml = render("magic/level-value", ctx.count);
  assert.match(ladderHtml, /data-figure="target\.count"/);
  assert.match(ladderHtml, /name="flags\.acks-extras\.spell\.target\.count\.kind" value="invocation"/);
  assert.match(ladderHtml, /data-rung-ladder="target\.count"/);
  assert.match(ladderHtml, /data-rung-actions data-rung-group="target\.count"/);
  assert.match(ladderHtml, /data-action="rungSave" data-rung-keys="target\.count"/);
  const flatHtml = render("magic/level-value", ctx.hdCap);
  assert.match(flatHtml, /\.hdCap\.flat" value="4"/);
  assert.ok(!/data-rung/.test(flatHtml));
  asGM(false);
  const player = render("magic/level-value", (await sheetOf(spellItem({ target: { count: IMPORTED() } }))._prepareContext({})).levelValues.count);
  assert.ok(!/data-action="rung/.test(player), "a Player's overview has no rung control and no bar");
  asGM(true);
});

await t("every partial a template draws is registered by the part that renders it, and no template carries a literal id", () => {
  const partials = (name) => [...read(`templates/${name}.hbs`).matchAll(/\{\{>\s*"([^"]+)"/g)].map((m) => m[1]);
  const lib = (name) => `modules/acks-extras/templates/lib/${name}.hbs`;
  const rowForm = EffectRowEditor.PARTS.form.templates;
  for (const name of partials("lib/effect-row-editor")) assert.ok(rowForm.includes(name), `the row editor's body registers ${name}`);
  for (const name of partials("lib/rung-footer")) assert.ok(EffectRowEditor.PARTS.footer.templates.includes(name), `the footer registers ${name}`);
  assert.equal(EffectRowEditor.PARTS.footer.template, "modules/acks-extras/templates/lib/rung-footer.hbs");
  for (const name of partials("magic/level-value")) assert.ok(Sheet.PARTS.overview.templates.includes(name), `the overview registers ${name}`);
  assert.deepEqual([...sheet.RUNG_PARTIALS].sort(), [lib("figure-kind"), lib("rung-actions"), lib("rung-ladder")]);
  for (const name of TEMPLATES) assert.ok(!/\sid="(?!\{\{)/.test(read(`templates/${name}.hbs`)), `${name} has a literal id`);
});

await t("every lang key the rung editor reads is in the lang file, and none of its keys is dead", () => {
  const sources = ["scripts/lib/rung-view.mjs", "scripts/lib/apps/effect-row-editor.mjs", "scripts/magic/spell-sheet.mjs", ...TEMPLATES.map((name) => `templates/${name}.hbs`)].map(read).join("\n");
  const used = new Set([...sources.matchAll(/ACKS-LIB\.(?:rungEditor|figureKind)\.[A-Za-z.]+/g)].map((m) => m[0]));
  const view = read("scripts/lib/rung-view.mjs");
  for (const m of view.matchAll(/loc\("([A-Za-z.]+)"/g)) used.add(`ACKS-LIB.rungEditor.${m[1]}`);
  for (const key of ["error.level", "error.figure", "error.duplicate", "error.descending", "rung.value", "rung.valueEdited", "saveRow", "saveRungs"]) used.add(`ACKS-LIB.rungEditor.${key}`);
  for (const kind of ["flat", "perLevel", "invocation"]) used.add(`ACKS-LIB.figureKind.${kind}`);
  used.add("ACKS-LIB.figureKind.group");
  for (const key of used) assert.ok(key in lang, `${key} is read and missing from the lang file`);
  const mine = Object.keys(lang).filter((key) => /^ACKS-LIB\.(rungEditor|figureKind)\./.test(key));
  for (const key of mine) assert.ok(used.has(key), `${key} is in the lang file and read nowhere`);
});

/* ------------------------------------------------------------------ */
/*  The tracked kinds' Lasts and the delayed affliction's Effects        */
/* ------------------------------------------------------------------ */

const { fieldsForType } = await import("../scripts/lib/apps/effect-row-editor.mjs");
const TRACKED = ["transform", "wall", "detect", "dispel", "illusion", "light", "teleport", "createObject", "structural", "curse", "afflictionDelay", "seal"];

/** The window's form as the editor reads it: dotted names expand as core's `expandObject` does. */
function formOf(fields) {
  foundry.applications.ux = { FormDataExtended: class { constructor(form) { this.object = form.fields; } } };
  foundry.utils.expandObject = (flat) => {
    const out = {};
    for (const [path, value] of Object.entries(flat)) setProperty(out, path, value);
    return out;
  };
  return { fields };
}

await t("Lasts is a tracked kind's field in a spell and nothing else's: purify keeps its quantity, an ability's rows never see it", () => {
  for (const kind of TRACKED) assert.ok(fieldsForType(kind, "spell").includes("lasts"), `${kind} edits lasts`);
  for (const kind of TRACKED) assert.ok(!fieldsForType(kind, "ability").includes("lasts"), `an ability's ${kind} row has no lasts`);
  for (const kind of ["purify", "heal", "slay", "summon", "control", "modifier", "ward"]) assert.ok(!fieldsForType(kind, "spell").includes("lasts"), `${kind} is not tracked`);
  assert.ok(fieldsForType("purify", "spell").includes("value"), "purify keeps its quantity field");
  assert.deepEqual(fieldsForType("afflictionDelay", "spell").slice(0, 3), ["appliesTo", "effects", "lasts"], "the board's order: applies to, effects, lasts");
  assert.ok(!fieldsForType("wall", "spell").includes("effects"), "only the delayed affliction picks effects");
});

await t("a tracked row's Lasts offers the duration or the instant, keeps a stored other value, carries the page, and a blank stays blank", async () => {
  asGM(true);
  const field = async (row) => fieldOf(await rowEditor({ current: [row] }).editor._prepareContext({}), "lasts");
  const wall = await field({ key: "a", type: "wall", lasts: "duration" });
  assert.deepEqual(Object.keys(wall.choices), ["duration", "instant"]);
  assert.equal(wall.value, "duration");
  assert.match(wall.tip, /tip\.lastsTracked/);
  assert.match(wall.tip, /tip\.cite {"cite":"Book p\. 9"}/, "the store's page is in the tooltip");
  assert.equal((await field({ key: "b", type: "seal" })).value, "", "no lasts is blank");
  assert.deepEqual(Object.keys((await field({ key: "c", type: "illusion", lasts: "rounds" })).choices), ["duration", "instant", "rounds"], "a stored rounds lasting stays selectable");
  assert.ok(Object.keys((await field({ key: "d", type: "conditionGrant", lasts: "duration" })).choices).includes("nextTurn"), "another kind keeps the whole vocabulary");
  assert.doesNotMatch((await field({ key: "e", type: "conditionGrant" })).tip, /lastsTracked/, "and its own tooltip");
});

await t("the delayed affliction's effect checks write the array on change, with Lasts beside them, and the redraw shows it", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "afflictionDelay", appliesTo: "recipient", lasts: "duration", effects: ["poison"] }] };
  const { editor, writes } = rowEditor(rows);
  const effects = fieldOf(await editor._prepareContext({}), "effects");
  assert.equal(effects.kind, "set");
  assert.ok(effects.options.length > 1, "the options are the effect list");
  assert.deepEqual(effects.options.filter((o) => o.checked).map((o) => o.key), ["poison"]);
  assert.match(effects.tip, /tip\.effectsDelay/);
  assert.match(effects.tip, /Book p\. 9/);
  editor.element = formOf({ "effects.poison": true, "effects.charm": true, "effects.sleep": false, lasts: "instant" });
  await EffectRowEditor.DEFAULT_OPTIONS.form.handler.call(editor);
  assert.equal(writes.length, 1, "one write for the change");
  assert.deepEqual(writes[0][0].effects, ["poison", "charm"], "the array is what is checked");
  assert.equal(writes[0][0].lasts, "instant", "the Lasts select writes its value");
  assert.equal(writes[0][0].appliesTo, "recipient", "the rest of the row is kept");
  assert.equal(editor.renders, 1, "and the window redraws");
  const after = fieldOf(await editor._prepareContext({}), "effects");
  assert.deepEqual(after.options.filter((o) => o.checked).map((o) => o.key).sort(), ["charm", "poison"]);
});

await t("a Player's view of a tracked row has the same fields and no footer: no gate of ownership is added to the editor", async () => {
  asGM(false);
  const rows = { current: [{ key: "a", type: "afflictionDelay", lasts: "duration", effects: ["poison"] }] };
  const ctx = await rowEditor(rows).editor._prepareContext({});
  assert.deepEqual(ctx.fields.map((f) => f.name).filter((name) => name !== "key").slice(0, 3), ["appliesTo", "effects", "lasts"]);
  assert.equal(ctx.footer.show, false, "no ladder, so no footer for a Player");
  assert.ok(!/data-action="rung/.test(render("lib/effect-row-editor", { ...ctx, partId: "p" })));
  assert.ok(!/isOwner/.test(read("scripts/lib/apps/effect-row-editor.mjs")), "the editor tests no ownership");
  asGM(true);
});

await t("the tracked row renders its Lasts select and the effect checks under their legend, every control named, no literal id and no fixed type size", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "afflictionDelay", appliesTo: "recipient", lasts: "instant", effects: ["poison"] }] };
  const html = render("lib/effect-row-editor", { ...(await rowEditor(rows).editor._prepareContext({})), partId: "p" });
  assert.match(html, /<select name="lasts" aria-label="ACKS-LIB\.effectEditor\.field\.lasts">/);
  assert.match(html, /<option value="instant" selected>/);
  assert.match(html, /<fieldset class="acks-extras-effect-set" data-tooltip-text="[^"]*tip\.effectsDelay[^"]*">\s*<legend>ACKS-LIB\.effectEditor\.field\.effects<\/legend>/);
  const checks = [...html.matchAll(/<label class="acks-extras-effect-pick">\s*<input type="checkbox" name="effects\.([a-zA-Z]+)"([^>]*)>\s*<span>/g)];
  assert.ok(checks.length > 1, "each effect key is a check wrapped in its own label");
  assert.equal(checks.filter((m) => /checked/.test(m[2])).length, 1);
  assert.ok(!/\sid="(?!\{\{)/.test(html), "no literal id");
  assert.ok(!/\b\d+(px|rem)\b/.test(read("templates/lib/effect-row-editor.hbs")), "no px or rem size in the template");
});

/* ------------------------------------------------------------------ */
/*  A summon row's "When control ends"                                  */
/* ------------------------------------------------------------------ */

await t("a spell's summon row edits When control ends as a select of stays, gone and hostile, after Control, with a tooltip; an ability's summon row has none", async () => {
  asGM(true);
  const row = { key: "a", type: "summon", control: "obedient", controlEnd: "hostile" };
  const field = fieldOf(await rowEditor({ current: [row] }).editor._prepareContext({}), "controlEnd");
  assert.equal(field.kind, "select");
  assert.deepEqual(Object.keys(field.choices), ["stays", "gone", "hostile"]);
  assert.equal(field.value, "hostile");
  assert.match(field.tip, /tip\.controlEnd/);
  assert.match(field.tip, /Book p\. 9/, "the store's page rides the tooltip");
  const names = (await rowEditor({ current: [row] }).editor._prepareContext({})).fields.map((f) => f.name);
  assert.ok(names.indexOf("controlEnd") > names.indexOf("control"), "it follows Control");
  assert.equal(fieldOf(await rowEditor({ current: [{ ...row }] }, { domain: "ability" }).editor._prepareContext({}), "controlEnd"), undefined, "a spell-only field is not offered on an ability");
  assert.equal(fieldOf(await rowEditor({ current: [{ key: "b", type: "summon" }] }).editor._prepareContext({}), "controlEnd").value, "", "blank stays blank, which reads as stays");
  assert.equal(fieldOf(await rowEditor({ current: [{ key: "c", type: "damage" }] }).editor._prepareContext({}), "controlEnd"), undefined, "no other kind has it");
});

await t("choosing When control ends writes the row's controlEnd and keeps the rest, in the rendered select with its own name", async () => {
  asGM(true);
  const rows = { current: [{ key: "a", type: "summon", control: "obedient", controlEnd: "stays", ref: "x.ref" }] };
  const { editor, writes } = rowEditor(rows);
  const html = render("lib/effect-row-editor", { ...(await editor._prepareContext({})), partId: "p" });
  assert.match(html, /<select name="controlEnd" aria-label="ACKS-LIB\.effectEditor\.field\.controlEnd">/);
  assert.match(html, /<option value="stays" selected>/);
  assert.match(html, /data-tooltip-text="[^"]*tip\.controlEnd[^"]*"/);
  editor.element = formOf({ controlEnd: "gone", control: "obedient", ref: "x.ref" });
  await EffectRowEditor.DEFAULT_OPTIONS.form.handler.call(editor);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0].controlEnd, "gone");
  assert.deepEqual([writes[0][0].control, writes[0][0].ref], ["obedient", "x.ref"]);
});

await t("the tracked kinds' words are in the lang file", () => {
  const root = ["ACKS", "LIB"].join("-");
  for (const key of ["tip.lastsTracked", "tip.effectsDelay", "lastsTracked.duration", "lastsTracked.instant", "field.lasts", "field.effects", "tip.cite", "field.controlEnd", "tip.controlEnd"]) assert.ok(`${root}.effectEditor.${key}` in lang, `${key} is missing from the lang file`);
});

console.log(`\n${n} passed`);
