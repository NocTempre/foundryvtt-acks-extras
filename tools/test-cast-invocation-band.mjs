/**
 * The cast dialog's one Invocation band, offline: the level as one select over
 * the tradition's cap ladder (a Player's levels above the cap disabled, a Judge's
 * chosen in the warn tone, every level offered where no cap was read, a number
 * box where there is no ladder, the cap preselected), the level threaded through
 * every question the dialog asks and answered to the cast, the implement-set
 * bucket (opens on the carried sets, the pick opens on the lowest set that
 * reaches the level, a set too low dimmed with its reason, `noSetReaches` blocking
 * a Player and warning a Judge, a drop, X and a pick through the window), and a
 * declared cast resolving from the stored level and pick with no dialog. The
 * window runs on a stand-in ApplicationV2, so what is proven is its wiring, never
 * Foundry's own rendering. The tradition, spells, sets and figures are invented,
 * so this file carries no book content.
 *
 * Usage: node tools/test-cast-invocation-band.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const notices = [];
const dragConfigs = [];
globalThis.Hooks = { on: () => 1, off() {}, once() {}, callAll() {} };
globalThis.ui = { notifications: { warn: (m) => notices.push(m), info() {} } };
const loaded = [];
globalThis.foundry = {
  utils: { escapeHTML: (s) => String(s) },
  applications: {
    handlebars: { loadTemplates: async (list) => void loaded.push(...list) },
    api: {
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      ApplicationV2: class {
        static instances = [];
        constructor(options = {}) {
          this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options };
          this.rendered = 0;
          this.closed = false;
          this.element = { nodeType: 1, querySelector: () => null, querySelectorAll: () => [] };
          this.constructor.instances.push(this);
        }
        async _prepareContext() {
          return {};
        }
        async render() {
          if (!this.rendered) await this._onFirstRender({}, {});
          this.rendered++;
          this.last = await this._prepareContext({});
          this._onRender({}, {});
        }
        async close() {
          if (this.closed) return;
          this.closed = true;
          this._onClose({});
        }
      },
    },
    ux: {
      DragDrop: { implementation: class { constructor(config) { dragConfigs.push(config); } bind() {} } },
      TextEditor: { implementation: { getDragEventData: (e) => e.data } },
    },
  },
};
globalThis.game = {
  i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key },
  settings: { get: () => "public" },
  user: { id: "u1", isGM: false, targets: new Set() },
};
globalThis.CONFIG = { ChatMessage: { modes: {} }, statusEffects: [] };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "7";
    return this;
  }
};
const docs = new Map();
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
globalThis.fromUuidSync = (uuid) => docs.get(uuid) ?? null;

const model = await import("../scripts/magic/apps/cast-dialog-model.mjs");
const { dialogContext, initialState, answerOf, levelView, bucketsOf } = model;
const { CastDialog } = await import("../scripts/magic/apps/cast-dialog.mjs");
const { registerCastProcedure, bucketStates, PICKED_KEY } = await import("../scripts/magic/cast-procedure.mjs");
const { implementsBucket, carriedSets, IMPLEMENTS_KEY } = await import("../scripts/magic/cast-implements.mjs");
const { castSpellRun } = await import("../scripts/magic/cast-spell.mjs");
const { traditionCapLadder } = await import("../scripts/classes/casting.mjs");
const { entriesFromAnswer } = await import("../scripts/lib/bucket.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};
const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/*  The level control                                                 */
/* ------------------------------------------------------------------ */

const LADDER = { key: "capLadder", label: "Test ladder", top: 5 };
const read = (over = {}) => ({ value: 2, source: "chosen", cap: 3, reads: true, offered: true, ladder: LADDER, classLevel: 6, ...over });
const baseCtx = (over = {}) => ({
  modes: ["normal"],
  groups: { normal: [] },
  rows: [],
  level: { value: 3, source: "class" },
  targets: [],
  holders: [],
  gaps: {},
  verdicts: { normal: [] },
  caster: { name: "Testcaster", img: "c.png" },
  spell: { name: "Testrite" },
  cite: "p. 9",
  isGM: false,
  ...over,
});

t("the level is one select over the ladder's levels: a Player's levels above the cap are disabled and say so, the cap is named, and the tooltip carries the cap, the ladder and the class level", () => {
  const view = levelView(baseCtx(), {}, read());
  assert.equal(view.isSelect, true);
  assert.deepEqual(view.options.map((o) => [o.value, o.selected, o.disabled]), [[1, false, false], [2, true, false], [3, false, false], [4, false, true], [5, false, true]]);
  assert.match(view.options[3].label, /invocationAbove\|.*"n":4/);
  assert.match(view.options[2].label, /invocationAtCap/);
  assert.match(view.cap, /invocationCap\|.*"cap":3/);
  assert.match(view.tip, /tip\.invocation\.cap\|.*"cap":3.*Test ladder.*"level":6/);
  assert.equal(view.tone, "");
});

t("a Judge may choose a level above the cap, in the warn tone, and the option says it is over", () => {
  const view = levelView(baseCtx({ isGM: true }), {}, read({ value: 5 }));
  assert.deepEqual(view.options.map((o) => o.disabled), [false, false, false, false, false]);
  assert.match(view.options[3].label, /invocationOver/);
  assert.equal(view.tone, "warn");
  assert.equal(levelView(baseCtx({ isGM: true }), {}, read({ value: 3 })).tone, "", "at the cap is no warning");
});

t("with no cap read every level of the ladder is offered, none disabled; with no ladder either the level is a number box marked as set by hand; where the cast asks for none the control is absent", () => {
  const free = levelView(baseCtx(), {}, read({ cap: null, value: null }));
  assert.deepEqual(free.options.map((o) => [o.value, o.disabled]), [["", false], [1, false], [2, false], [3, false], [4, false], [5, false]], "a blank choice leads while no level is set");
  assert.equal(free.cap, "");
  assert.match(free.tip, /Test ladder.*uncapped/);
  const hand = levelView(baseCtx(), { invocationLevel: "2" }, read({ cap: null, ladder: null, value: 2 }));
  assert.deepEqual([hand.isSelect, hand.value], [false, "2"]);
  assert.match(hand.hand, /invocationHand/);
  assert.equal(levelView(baseCtx(), {}, read({ offered: false })).show, false);
});

t("a ladder's top is the highest whole rung, and a ladder with none reads null", () => {
  const classItem = { system: { casting: [{ key: "k", levelCap: "lad" }], ladders: [{ key: "lad", label: "Lad", values: [{ atLevel: 1, value: 1 }, { atLevel: 5, value: 4 }, { atLevel: 9, value: 2.5 }] }] } };
  assert.deepEqual(traditionCapLadder(classItem, "k"), { key: "lad", label: "Lad", top: 4 });
  assert.equal(traditionCapLadder({ system: { casting: [{ key: "k" }], ladders: [] } }, "k"), null);
  assert.equal(traditionCapLadder({ system: { casting: [{ key: "k", levelCap: "gone" }], ladders: [] } }, "k"), null);
  assert.equal(traditionCapLadder({ system: { casting: [{ key: "k", levelCap: "lad" }], ladders: [{ key: "lad", values: [{ atLevel: 1, value: "x" }] }] } }, "k"), null);
});

t("the dialog opens on the cap (R.1), a declaration reopens on its own level, and a level nobody asks for opens blank", () => {
  const ctx = baseCtx({ invocation: { normal: read({ value: null }) } });
  assert.equal(initialState(ctx).invocationLevel, "3");
  assert.equal(initialState(baseCtx({ ...ctx, initial: { invocationLevel: 2 } })).invocationLevel, 2);
  assert.equal(initialState(baseCtx({ invocation: { normal: read({ cap: null }) } })).invocationLevel, "", "no cap, nothing to preselect");
  assert.equal(initialState(baseCtx({ invocation: { normal: read({ offered: false }) } })).invocationLevel, "");
});

t("the level the seat holds is every question's level and the answer: verdicts, reach, gates, pending, moment, procedure and groups are asked at it, and it is answered as a whole number or null", () => {
  const asked = [];
  const ctx = baseCtx({
    invocation: { normal: read({ value: null }) },
    invocationAt: (mode, inv) => read({ value: Number.isInteger(Number(inv)) && inv !== "" ? Number(inv) : null }),
    verdictsAt: (...args) => (asked.push(["verdicts", args[4]]), []),
    reachAt: (level, inv, mode) => (asked.push(["reach", inv, mode]), null),
    gatesAt: (level, inv) => (asked.push(["gates", inv]), {}),
    pendingAt: (mode, picks, level, inv) => (asked.push(["pending", inv]), {}),
    momentAt: (mode, level, praw, inv) => (asked.push(["moment", inv]), "free"),
    groupsAt: (mode, inv) => (asked.push(["groups", inv]), []),
    procedure: { at: (mode, praw, level, inv) => (asked.push(["procedure", inv]), { specs: [], answer: {}, band: null, buckets: [], findings: [] }), traditionLabel: "Testtrad" },
  });
  const view = dialogContext(ctx, { invocationLevel: "4" });
  assert.deepEqual([...new Set(asked.map(([, inv]) => inv))].filter((v) => v !== "normal" && v !== undefined), [4]);
  for (const key of ["verdicts", "reach", "gates", "pending", "moment", "groups", "procedure"]) assert.ok(asked.some(([k, inv]) => k === key && inv === 4), `${key} is asked at the level`);
  assert.equal(view.invocation.level.options.find((o) => o.selected).value, 4);
  assert.equal(answerOf(ctx, { ...initialState(ctx), invocationLevel: "4" }).invocationLevel, 4);
  assert.equal(answerOf(ctx, { ...initialState(ctx), invocationLevel: "" }).invocationLevel, null, "blank answers no level");
  assert.equal(answerOf(baseCtx({ invocation: { normal: read({ offered: false }) } }), { invocationLevel: "3" }).invocationLevel, null, "a level the cast does not ask for is not answered");
});

t("the band is shown for a capped tradition with no procedure, headed by the tradition's own label, and hidden where nothing is asked", () => {
  const ctx = baseCtx({ invocation: { normal: read() }, traditionLabel: "Testtrad" });
  const view = dialogContext(ctx, {});
  assert.equal(view.invocation.show, true);
  assert.equal(view.invocation.title, "Testtrad");
  assert.equal(dialogContext(baseCtx({ invocation: { normal: read({ offered: false }) } }), {}).invocation.show, false);
});

/* ------------------------------------------------------------------ */
/*  The implements bucket                                             */
/* ------------------------------------------------------------------ */

const set = (id, level, damage = 0, over = {}) => ({ uuid: `Actor.c1.Item.${id}`, id, name: `Set ${id}`, img: over.img ?? `${id}.png`, documentName: "Item", type: "gear", system: { cost: 0 }, flags: { "acks-extras": { ceremony: { implementLevel: level, damage } } }, ...over });
const SETS = { a: set("a", 2), b: set("b", 4, 1), c: set("c", 3, 2), d: set("d", 5) };
const plain = { uuid: "Actor.c1.Item.p", id: "p", name: "Plain thing", img: "", documentName: "Item", type: "gear", system: { cost: 0 }, flags: {} };
const caster = { uuid: "Actor.c1", name: "Tester", type: "character", isOwner: true, items: [SETS.a, SETS.b, SETS.c, plain] };
for (const doc of [...Object.values(SETS), plain]) docs.set(doc.uuid, doc);

const KIND = "bandkind";
const bucketProcedure = (over = {}) => ({
  label: "ACKS-MAGIC.cast.dialog.invocation",
  buckets: (ctx) => [implementsBucket(ctx, { cite: "Test p. 1" })],
  ...over,
});
const ctxFor = (level, extra = {}) => ({ actor: caster, invocationLevel: level, resolve: (uuid) => docs.get(uuid) ?? null, ...extra });

const bucketAnswerOf = (proc, inv, praw) => {
  const states = bucketStates(proc, ctxFor(inv), praw);
  return { buckets: Object.fromEntries(states.map((s) => [s.key, s.list])), [PICKED_KEY]: Object.fromEntries(states.filter((s) => s.picked).map((s) => [s.key, s.picked])) };
};

t("the bucket opens holding the carried sets, never an item with no level, and its pick opens on the lowest set whose effective level reaches the level", () => {
  assert.deepEqual(carriedSets(caster).map((i) => i.id), ["a", "b", "c"]);
  const [state] = bucketStates(bucketProcedure(), ctxFor(3), {});
  assert.deepEqual(state.rows.map((r) => r.uuid), ["Actor.c1.Item.a", "Actor.c1.Item.b", "Actor.c1.Item.c"]);
  assert.equal(state.picked, "Actor.c1.Item.b", "set a (2) and c (3 less 2) fall short; b (4 less 1) is the lowest that reaches 3");
  assert.equal(bucketStates(bucketProcedure(), ctxFor(1), {})[0].picked, "Actor.c1.Item.c", "at 1 the lowest effective set is c (level 3 less damage 2)");
  assert.equal(bucketStates(bucketProcedure(), ctxFor(2), {})[0].picked, "Actor.c1.Item.a", "at 2 c falls short and a is the lowest that reaches");
  assert.deepEqual(state.findings, []);
});

t("with no set reaching the level the bucket's finding is noSetReaches, worded by the bucket; with no level set nothing is missing and nothing is picked", () => {
  const [none] = bucketStates(bucketProcedure(), ctxFor(5), {});
  assert.equal(none.picked, null);
  assert.deepEqual(none.findings.map((f) => f.key), ["noSetReaches"]);
  assert.match(none.findings[0].notice, /noSetReaches\|.*"needed":5/);
  const [unset] = bucketStates(bucketProcedure(), ctxFor(null), {});
  assert.deepEqual([unset.picked, unset.findings], [null, []]);
});

t("the seat's pick stands while its set still reaches the level and the pick opens again when it no longer does; a dropped set is a row, and a uuid the world no longer holds is left out", () => {
  const held = { buckets: { implements: [{ uuid: "Actor.c1.Item.a", qty: 1, fit: "" }, { uuid: "Actor.c1.Item.d", qty: 1, fit: "" }, { uuid: "Actor.c1.Item.gone", qty: 1, fit: "" }] }, picked: { implements: "Actor.c1.Item.d" } };
  const [state] = bucketStates(bucketProcedure(), ctxFor(3), held);
  assert.deepEqual(state.rows.map((r) => r.uuid), ["Actor.c1.Item.a", "Actor.c1.Item.d"]);
  assert.equal(state.picked, "Actor.c1.Item.d", "the seat's pick of a set that reaches the level stands over the lowest");
  assert.equal(bucketStates(bucketProcedure(), ctxFor(6), held)[0].picked, null, "a pick that no longer reaches the level is not kept");
  const lowered = { ...held, picked: { implements: "Actor.c1.Item.a" } };
  assert.equal(bucketStates(bucketProcedure(), ctxFor(3), lowered)[0].picked, "Actor.c1.Item.d", "a pick too low for the level opens on the lowest that reaches it");
});

await ta("a row is drawn from its entry alone: the picture, 'Level N · effective M', diamonds filled for the effective level and hollow for the levels lost, Used on the pick, a set too low disabled with its reason", async () => {
  const proc = bucketProcedure();
  const ctx = baseCtx({ invocation: { normal: read({ value: 3 }) }, invocationAt: () => read({ value: 3 }), procedure: { at: (mode, praw, level, inv) => ({ specs: [], answer: bucketAnswerOf(proc, inv, praw), band: null, buckets: bucketStates(proc, ctxFor(inv), praw), findings: [] }) } });
  const states = bucketsOf(ctx, { mode: "normal", invocationLevel: "3", procedure: {} });
  const entries = { [IMPLEMENTS_KEY]: (await entriesFromAnswer(states[0].list, fromUuid, { policy: states[0].policy })).entries };
  const [view] = dialogContext(ctx, { invocationLevel: "3" }, { entries }).invocation.buckets;
  assert.deepEqual([view.pick, view.key, view.canDrop], [true, "implements", true]);
  const rows = Object.fromEntries(view.rows.map((r) => [r.name, r]));
  assert.deepEqual([rows["Set a"].off, rows["Set a"].disabled], [true, true]);
  assert.match(rows["Set a"].reason, /tooLow|.*"effective":2.*"needed":3/);
  assert.equal(rows["Set a"].img, "a.png", "the document's own picture");
  assert.deepEqual([rows["Set b"].picked, rows["Set b"].off, rows["Set b"].disabled], [true, false, false], "the pick is the lowest reaching set");
  assert.match(rows["Set b"].caption, /caption\|.*"level":4.*"effective":3/);
  assert.deepEqual(rows["Set b"].diamonds, [true, true, true, false]);
  assert.match(rows["Set b"].captionTip, /captionTip\|.*"damage":1.*Test p\. 1/);
  assert.match(view.legend, /implements.legend/);
  assert.deepEqual(rows["Set c"].diamonds, [true, false, false], "level 3 less damage 2: one filled, two lost");
  const answer = answerOf(ctx, { mode: "normal", invocationLevel: "3", procedure: {} });
  assert.deepEqual([answer.procedure.picked, answer.procedure.buckets.implements.map((e) => e.uuid)], [{ implements: "Actor.c1.Item.b" }, ["Actor.c1.Item.a", "Actor.c1.Item.b", "Actor.c1.Item.c"]], "a seat that never touches the bucket still answers its opening list and pick");
});

/* ------------------------------------------------------------------ */
/*  The window                                                        */
/* ------------------------------------------------------------------ */

/** A context over the implements bucket whose procedure view is read at the level the window holds. */
const read2 = read;
const windowCtx = (over = {}) => {
  const proc = bucketProcedure();
  return baseCtx({
    isGM: false,
    invocation: { normal: read({ value: 3 }) },
    invocationAt: (mode, inv) => read({ value: Number(inv) || null }),
    procedure: { at: (mode, praw, level, inv) => ({ specs: [], answer: { ...praw, ...bucketAnswerOf(proc, inv, praw) }, band: null, buckets: bucketStates(proc, ctxFor(inv), praw), findings: [] }) },
    ...over,
  });
};

await ta("the window loads lib's bucket partials, binds a drop zone on the bucket, and answers the level and the pick on Cast", async () => {
  CastDialog.instances.length = 0;
  loaded.length = 0;
  const asked = CastDialog.wait(windowCtx());
  await settle();
  const [dialog] = CastDialog.instances;
  assert.ok(loaded.some((p) => p.endsWith("templates/lib/bucket.hbs")) && loaded.some((p) => p.endsWith("templates/lib/bucket-row.hbs")), "both partials are loaded before the render");
  assert.ok(dragConfigs.some((c) => c.dropSelector === "[data-bucket-drop]"), "a drop zone is bound on the bucket's own selector");
  assert.deepEqual(Object.keys(CastDialog.DEFAULT_OPTIONS.actions).filter((k) => k.startsWith("bucket")).sort(), ["bucketFit", "bucketPick", "bucketRemove"]);
  assert.equal(dialog.last.invocation.buckets[0].rows.length, 3);
  // The select's own value is what the window reads back into the answer.
  dialog.element = { nodeType: 1, querySelector: (sel) => (sel === '[name="invocationLevel"]' ? { value: "2" } : null), querySelectorAll: () => [] };
  CastDialog.DEFAULT_OPTIONS.actions.cast.call(dialog, {}, {});
  const answer = await asked;
  assert.deepEqual([answer.invocationLevel, answer.procedure.picked], [2, { implements: "Actor.c1.Item.a" }], "the level the select holds is answered, and the pick opens at it");
});

await ta("a drop adds a set once, of a kind the bucket takes; X removes one and a pick that named it opens again; a radio picks the set used", async () => {
  CastDialog.instances.length = 0;
  notices.length = 0;
  const asked = CastDialog.wait(windowCtx());
  await settle();
  const [dialog] = CastDialog.instances;
  const { actions } = CastDialog.DEFAULT_OPTIONS;
  const zone = { classList: { remove() {} }, dataset: { bucketDrop: "implements" } };
  const drop = dragConfigs.at(-1).callbacks.drop;
  await drop({ currentTarget: zone, data: { type: "Item", uuid: SETS.d.uuid } });
  await settle();
  assert.deepEqual(dialog.last.invocation.buckets[0].rows.map((r) => r.name), ["Set a", "Set b", "Set c", "Set d"], "the dropped set is a row, the carried ones kept");
  await drop({ currentTarget: zone, data: { type: "Item", uuid: SETS.d.uuid } });
  await drop({ currentTarget: zone, data: { type: "Actor", uuid: "Actor.c1" } });
  await drop({ currentTarget: zone, data: { type: "Item", uuid: "Actor.c1.Item.nope" } });
  assert.equal(dialog.last.invocation.buckets[0].rows.length, 4, "a repeat, a creature and a missing item add nothing");
  assert.equal(notices.length, 3, "and each says why");
  const row = (uuid) => ({ dataset: { uuid }, closest: () => ({ dataset: { bucket: "implements" } }) });
  actions.bucketPick.call(dialog, {}, row(SETS.d.uuid));
  await settle();
  assert.equal(dialog.last.invocation.buckets[0].rows.find((r) => r.picked).name, "Set d");
  actions.bucketRemove.call(dialog, {}, row(SETS.d.uuid));
  await settle();
  const after = dialog.last.invocation.buckets[0];
  assert.deepEqual(after.rows.map((r) => r.name), ["Set a", "Set b", "Set c"], "X removes the set");
  assert.equal(after.rows.find((r) => r.picked).name, "Set b", "the pick that named it opens again on the lowest reaching set");
  actions.cancel.call(dialog, {}, {});
  assert.equal(await asked, null);
});

await ta("a Player with no set reaching the level cannot Cast and a Judge can, each told; the finding is the bucket's own", async () => {
  CastDialog.instances.length = 0;
  const verdicts = (isGM) => (mode, picks, level, alloc, inv, praw) => bucketStates(bucketProcedure(), ctxFor(inv), praw).flatMap((s) => s.findings).map((f) => ({ key: f.key, notice: f.notice, severity: isGM ? "warn" : "block" }));
  const player = CastDialog.wait(windowCtx({ invocation: { normal: read({ value: 5 }) }, invocationAt: () => read({ value: 5 }), verdictsAt: verdicts(false) }));
  await settle();
  const [blocked] = CastDialog.instances;
  assert.equal(blocked.last.footer.blocked, true);
  assert.match(blocked.last.footer.verdicts[0].text, /noSetReaches/);
  CastDialog.DEFAULT_OPTIONS.actions.cast.call(blocked, {}, {});
  assert.equal(blocked.closed, false, "a Player is blocked");
  CastDialog.DEFAULT_OPTIONS.actions.cancel.call(blocked, {}, {});
  assert.equal(await player, null);
  CastDialog.instances.length = 0;
  const judge = CastDialog.wait(windowCtx({ isGM: true, invocation: { normal: read({ value: 5 }) }, invocationAt: () => read({ value: 5 }), verdictsAt: verdicts(true) }));
  await settle();
  const [warned] = CastDialog.instances;
  CastDialog.DEFAULT_OPTIONS.actions.cast.call(warned, {}, {});
  assert.equal(warned.closed, true, "a Judge is warned and casts");
  assert.equal((await judge).invocationLevel, 5);
});

/* ------------------------------------------------------------------ */
/*  The cast                                                          */
/* ------------------------------------------------------------------ */

const tradition = { key: "bandtrad", label: "Bandtrad", kind: KIND, slots: [], spellList: [] };
const classItem = { system: { casting: [tradition], ladders: [] } };
const rite = (extra = {}) => ({
  type: "spell",
  name: "Testrite",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  system: { lvl: 1, class: "" },
  flags: { "acks-extras": { spell: { lists: [{ source: "bandtrad", level: 1 }], effects: [{ key: "mend", type: "heal", roll: "1d4" }], ...extra } } },
  parent: caster,
});
function runDeps({ answer, isGM = false, cap = 3, declared = null, holds = async () => true } = {}) {
  const calls = { posts: [], notices: [], texts: [], performs: [], asked: 0, declares: [] };
  const deps = {
    lookups: { byCookbookId: () => null, fromUuidSync: (uuid) => docs.get(uuid) ?? null },
    read: async () => ({ actor: caster, tokens: [], casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: false, classLevel: 6 }, cap, ladder: LADDER, tradition, classItem, ...(declared ?? {}) }),
    ask: async (ctx) => (calls.asked++, (calls.ctx = ctx), answer),
    notify: (lvl, key) => calls.notices.push([lvl, key]),
    notifyText: (lvl, text) => calls.texts.push([lvl, text]),
    adjustPool: async () => {},
    castId: () => "castX",
    roll: () => 1,
    post: async (c) => (calls.posts.push(c), { id: "m1", flags: { "acks-extras": { castCard: c } } }),
    apply: async () => ({ ok: true }),
    record: async () => {},
    throwRow: async () => null,
    now: () => 10,
    isGM: () => isGM,
    endHeld: async () => {},
    holds,
    declare: { declare: async (from) => (calls.declares.push(from), { castId: "d1" }), finish: async () => {}, clearHand: async () => {} },
  };
  return { calls, deps };
}
const performing = (calls, over = {}) => bucketProcedure({ perform: async (ctx, answer) => (calls.performs.push({ ctx, answer }), { proceed: true, section: null, rolls: [], undo: null }), ...over });
const levelAnswer = (level, procedure = {}) => ({ mode: "normal", picks: {}, items: {}, allocation: {}, saveMod: false, invocationLevel: level, procedure });

await ta("the context the cast hands the dialog carries the level's reading, the ladder and the resolver; the chosen level reaches the card's note and the pick reaches the procedure's perform", async () => {
  const r = runDeps({ answer: levelAnswer(3, { buckets: { implements: [{ uuid: SETS.b.uuid, qty: 1, fit: "" }, { uuid: SETS.d.uuid, qty: 1, fit: "" }] }, picked: { implements: SETS.d.uuid } }) });
  const off = registerCastProcedure(KIND, performing(r.calls));
  try {
    const out = await castSpellRun(rite(), () => {}, r.deps);
    assert.equal(out.ok, true);
    const ctx = r.calls.ctx;
    assert.deepEqual([ctx.invocationAt("normal", "4").value, ctx.invocationAt("normal", "4").ladder.top, ctx.invocationAt("normal", "4").cap, ctx.traditionLabel], [4, 5, 3, "Bandtrad"]);
    assert.equal(ctx.resolve(SETS.a.uuid), SETS.a);
    assert.equal(r.calls.posts[0].invocationLevel, 3, "the card carries the level the dialog answered");
    const { answer } = r.calls.performs[0];
    assert.deepEqual([answer.picked, answer.buckets.implements.map((e) => e.uuid)], [{ implements: SETS.d.uuid }, [SETS.b.uuid, SETS.d.uuid]]);
    assert.equal(r.calls.performs[0].ctx.invocationLevel, 3);
    // The card's own level note names the level.
    const { castCardView } = await import("../scripts/magic/cast-card.mjs");
    assert.match(castCardView(r.calls.posts[0], { isGM: false, canPress: false }, (k, d) => `${k}|${JSON.stringify(d ?? {})}`).note, /note.invocation|.*"value":3/);
  } finally {
    off();
  }
});

await ta("the moment the dialog reads is asked at the level the seat holds: a procedure whose casting time reads the level makes the cast long at one level and not at another", async () => {
  const off = registerCastProcedure(KIND, performing({ performs: [] }, { castingTime: (ctx) => (ctx.invocationLevel >= 4 ? { shape: "timed", value: 3, unit: "turns" } : null) }));
  try {
    const r = runDeps({ answer: null, declared: { combat: { id: "k1", started: true, round: 1, turn: 1, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: "cb1" } }, combatant: { id: "cb1", initiative: 9 } } });
    await castSpellRun(rite(), () => {}, r.deps);
    const ctx = r.calls.ctx;
    assert.notEqual(ctx.momentAt("normal", 3, {}, 4), ctx.momentAt("normal", 3, {}, 1));
  } finally {
    off();
  }
});

await ta("a level above the cap blocks a Player and warns a Judge, and no set reaching the level does the same, each in the bucket's own words", async () => {
  const over = (isGM) => runDeps({ isGM, answer: levelAnswer(5, { buckets: { implements: [{ uuid: SETS.d.uuid, qty: 1, fit: "" }] } }) });
  const none = (isGM) => runDeps({ isGM, cap: 6, answer: levelAnswer(6, { buckets: { implements: [{ uuid: SETS.a.uuid, qty: 1, fit: "" }] } }) });
  const off = registerCastProcedure(KIND, performing({ performs: [] }));
  try {
    const p = over(false);
    assert.equal((await castSpellRun(rite(), () => {}, p.deps)).reason, "overCap");
    const j = over(true);
    const done = await castSpellRun(rite(), () => {}, j.deps);
    assert.equal(done.ok, true, "a Judge casts over the cap");
    assert.ok(j.calls.notices.some(([, key]) => key === "verdict.overCap"));
    const np = none(false);
    const stopped = await castSpellRun(rite(), () => {}, np.deps);
    assert.equal(stopped.reason, "noSetReaches");
    assert.match(np.calls.texts[0][1], /noSetReaches\|.*"needed":6/);
    const nj = none(true);
    assert.equal((await castSpellRun(rite(), () => {}, nj.deps)).ok, true, "a Judge casts with no set reaching");
    assert.ok(nj.calls.texts.some(([, text]) => /noSetReaches/.test(text)));
  } finally {
    off();
  }
});

const fight = (combatantId) => ({ combat: { id: "k1", started: true, round: 1, turn: 1, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: combatantId } }, combatant: { id: "cb1", initiative: 9 } });

await ta("a declared cast stores the level and the bucket with its pick, and resolves at its turn from them with no dialog; the set is judged again then, and a pick lost before the turn opens on the lowest set that still reaches", async () => {
  const { answerStored, answerFromPending } = await import("../scripts/magic/cast-declare.mjs");
  const performs = [];
  const off = registerCastProcedure(KIND, performing({ performs }));
  try {
    const dialogAnswer = levelAnswer(3, { buckets: { implements: [{ uuid: SETS.b.uuid, qty: 1, fit: "" }, { uuid: SETS.d.uuid, qty: 1, fit: "" }] }, picked: { implements: SETS.d.uuid } });
    const stored = [];
    const declare = runDeps({ answer: dialogAnswer, declared: fight("cb2") });
    declare.deps.declare.declare = async (from) => (stored.push(from.answer), { castId: "d1" });
    assert.equal((await castSpellRun(rite(), () => {}, declare.deps)).declared, true);
    assert.deepEqual(performs, [], "nothing is performed at the declaring");
    const kept = answerStored(stored[0]);
    assert.equal(kept.invocationLevel, 3);
    assert.deepEqual([kept.procedure.picked, kept.procedure.buckets.implements.length], [{ implements: SETS.d.uuid }, 2]);
    const pending = { spellUuid: "Actor.c1.Item.s1", ...kept, combatId: "k1", round: 1, at: 3, targets: [] };
    assert.equal(answerFromPending(pending).invocationLevel, 3, "the level is read back as the answer the cast takes");
    const turnOf = (over = {}) => {
      const r = runDeps({ answer: null, ...over, declared: { ...fight("cb1"), declarations: [{ castId: "d1", role: "caster", pending }] } });
      r.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
      return r;
    };
    const turn = turnOf();
    const out = await castSpellRun(rite(), () => {}, turn.deps);
    assert.equal(out.ok, true);
    assert.equal(turn.calls.asked, 0, "a stored answer that fits asks nothing");
    assert.deepEqual([performs[0].answer.picked, performs[0].ctx.invocationLevel, performs[0].ctx.moment], [{ implements: SETS.d.uuid }, 3, "resolve"], "performed on the stored pick and level");
    assert.equal(turn.calls.posts[0].invocationLevel, 3);
    // The picked set is lost before the turn: the world no longer holds it, and the pick opens on the lowest set that still reaches the level.
    const keep = docs.get(SETS.d.uuid);
    docs.delete(SETS.d.uuid);
    performs.length = 0;
    const lost = turnOf({ holds: async (uuid) => docs.has(uuid) });
    assert.equal((await castSpellRun(rite(), () => {}, lost.deps)).ok, true);
    assert.equal(lost.calls.asked, 0, "no dialog reopens for a lost set");
    assert.deepEqual(performs[0].answer.picked, { implements: SETS.b.uuid }, "the lost pick is gone and the lowest reaching set stands");
    assert.deepEqual(performs[0].answer.buckets.implements.map((e) => e.uuid), [SETS.b.uuid]);
    // The remaining set is worn down before the turn: no set reaches, and a Player is blocked at the turn.
    const worn = SETS.b.flags["acks-extras"].ceremony;
    const was = worn.damage;
    worn.damage = 3;
    performs.length = 0;
    const blocked = turnOf({ holds: async (uuid) => docs.has(uuid) });
    const refused = await castSpellRun(rite(), () => {}, blocked.deps);
    assert.deepEqual([refused.ok, refused.reason, performs.length], [false, "noSetReaches", 0]);
    worn.damage = was;
    docs.set(SETS.d.uuid, keep);
  } finally {
    off();
  }
});

await ta("the real templates render the band: one select with its disabled options and the cap, the bucket through lib's partials with its drop zone, radios, the Used tag, diamonds and the reason in full ink", async () => {
  const Handlebars = (await import("handlebars")).default;
  Handlebars.registerHelper("localize", (key) => key);
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  Handlebars.registerPartial("modules/acks-extras/templates/lib/bucket.hbs", read("../templates/lib/bucket.hbs"));
  Handlebars.registerPartial("modules/acks-extras/templates/lib/bucket-row.hbs", read("../templates/lib/bucket-row.hbs"));
  const ctx = windowCtx({ invocation: { normal: read2({ value: 3 }) }, invocationAt: () => read2({ value: 3 }), traditionLabel: "Testtrad" });
  const states = bucketsOf(ctx, { mode: "normal", invocationLevel: "3", procedure: {} });
  const entries = { implements: (await entriesFromAnswer(states[0].list, fromUuid, { policy: states[0].policy })).entries };
  const html = Handlebars.compile(read("../templates/magic/cast-dialog.hbs"))(dialogContext(ctx, { invocationLevel: "3" }, { entries }));
  assert.match(html, /<select name="invocationLevel">/);
  assert.equal((html.match(/<option [^>]*disabled/g) ?? []).length, 2, "the two levels above the cap are disabled for a Player");
  assert.match(html, /acks-extras-cast-cap[^>]*>[^<]*invocationCap/);
  assert.match(html, /data-bucket-drop="implements"/);
  assert.equal((html.match(/type="radio" class="acks-extras-bucket__radio"/g) ?? []).length, 3);
  assert.equal((html.match(/acks-extras-bucket__tag is-ok/g) ?? []).length, 1, "the pick is tagged Used");
  assert.match(html, /acks-extras-bucket__diamonds/);
  assert.match(html, /<span class="acks-extras-bucket__reason">[^<]*tooLow/);
  assert.ok(html.includes("<h3>Testtrad</h3>"), "the band is headed by the tradition's own label");
  assert.ok(html.indexOf("invocationLevel") < html.indexOf("data-bucket-drop"), "the level leads, the bucket follows");
});

await ta("the real template draws a summons' Summon band in the targets band's place: the creature select, the count with its ceiling and tooltip, the placement; a spell that summons nothing keeps its targets", async () => {
  const Handlebars = (await import("handlebars")).default;
  Handlebars.registerHelper("localize", (key) => key);
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
  const render = (ctx, state = {}) => Handlebars.compile(read("../templates/magic/cast-dialog.hbs"))(dialogContext(ctx, state)).replaceAll("&quot;", "\"");
  const summon = {
    creatures: [{ value: "uA", name: "Alpha", amount: 2, source: null }, { value: "uB", name: "", amount: 3, source: null }],
    shelves: [],
    at: (pick) => ({ count: pick.count, ceiling: 4, calling: false, refused: null, range: 20 }),
  };
  const html = render(baseCtx({ summon }));
  assert.match(html, /<select name="summonRef">\s*<option value="uA" selected>Alpha<\/option><option value="uB">ACKS-LIB\.summons\.creatureN\|\{"n":2\}<\/option>/);
  assert.match(html, /<input type="number" name="summonCount" min="1" step="1" value="2">/);
  assert.match(html, /acks-extras-cast-cap acks-nums" data-tooltip-text="ACKS-MAGIC\.cast\.tip\.summonCeiling|{"max":4,"name":"Alpha"/);
  assert.match(html, /summonWithin\|\{"feet":20/);
  assert.doesNotMatch(html, /acks-extras-cast-targets"/, "a summons draws no Targets band");
  assert.doesNotMatch(html, /name="summonCount"[^>]*\sid=/);
  assert.match(render(baseCtx()), /acks-extras-cast-targets"/, "a cast that summons nothing keeps its Targets band");
  assert.doesNotMatch(render(baseCtx()), /summonRef/);
  const shelf = render(baseCtx({ summon: { creatures: [], shelves: [{ label: "Invented shelf", entries: [{ uuid: "uZ", name: "Zebra" }] }], at: () => null } }));
  assert.match(shelf, /<optgroup label="Invented shelf"><option value="uZ" selected>Zebra<\/option><\/optgroup>/);
  assert.match(render(baseCtx({ summon: { creatures: [], shelves: [] } })), /ACKS-LIB\.summons\.noMonsters/, "no creature to offer says so, with no select");
});

/* ------------------------------------------------------------------ */
/*  The surfaces                                                      */
/* ------------------------------------------------------------------ */

t("the template draws one select named invocationLevel, the buckets through lib's partial and no literal id; the model, window, helper and stylesheet read the ramp", () => {
  const hbs = fs.readFileSync(new URL("../templates/magic/cast-dialog.hbs", import.meta.url), "utf8");
  assert.match(hbs, /<select name="invocationLevel"/);
  assert.match(hbs, /templates\/lib\/bucket\.hbs/);
  assert.doesNotMatch(hbs, /\sid="/, "a template renders once per window, so it writes no id");
  const css = fs.readFileSync(new URL("../styles/magic.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf(".acks-extras-cast-invlevel"), css.indexOf(".acks-extras-cast-rows {"));
  assert.doesNotMatch(block, /\d(px|rem)\b/, "the level's rules carry no fixed type size");
});

console.log(`\n${n} cast invocation band tests passed`);
