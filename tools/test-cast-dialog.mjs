/**
 * Offline tests for the cast dialog (`scripts/magic/apps/cast-dialog-model.mjs`
 * and the window around it, `cast-dialog.mjs`): the targets bucket that is the
 * seat's own `game.user.targets` (X, an Actor drop on a scene with none, one or
 * several tokens, a Token drop, "Add my token"), the answer that survives a
 * re-render, the per-holder weapon picks (ruling 124), the creature-kind pick
 * (ruling 139), the effect rows' tones, and the cast reading the bucket again
 * after the answer. The window runs on a stand-in ApplicationV2, so what is
 * proven is its wiring (the hook, the close, the actions), never Foundry's own
 * rendering. Every spell, creature and figure below is invented, so this file
 * carries no book content.
 *
 * Usage: node tools/test-cast-dialog.mjs
 */
import assert from "node:assert/strict";

const hooks = new Map();
let hookId = 0;
const notices = [];
globalThis.Hooks = {
  on: (name, fn) => (hooks.set(++hookId, { name, fn }), hookId),
  off: (name, id) => void hooks.delete(id),
  once() {},
  callAll() {},
};
const fire = (name, ...args) => [...hooks.values()].filter((h) => h.name === name).forEach((h) => h.fn(...args));
globalThis.ui = { notifications: { warn: (m) => notices.push(m), info() {} } };
globalThis.foundry = {
  utils: { escapeHTML: (s) => String(s) },
  applications: {
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
    ux: { DragDrop: { implementation: class { bind() {} } }, TextEditor: { implementation: { getDragEventData: (e) => e.data } } },
  },
};
globalThis.game = {
  i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key },
  settings: { get: () => "public" },
  user: { id: "u1", isGM: false, targets: new Set() },
};
globalThis.CONFIG = { ChatMessage: { modes: {} }, statusEffects: [{ id: "afraid", img: "afraid.svg" }] };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "3 + 4";
    return this;
  }
};

const model = await import("../scripts/magic/apps/cast-dialog-model.mjs");
const { dialogContext, initialState, answerOf, resolveDrop, resolveActor, addTarget, untarget, effectRow } = model;
const { CastDialog } = await import("../scripts/magic/apps/cast-dialog.mjs");
const { castSpellRun } = await import("../scripts/magic/cast-spell.mjs");
const { kindChoices } = await import("../scripts/magic/cast-mods.mjs");

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
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/*  The bucket                                                         */
/* ------------------------------------------------------------------ */

/** A canvas token as `game.user.targets` holds it, with a spy on `setTarget`. */
const canvasToken = (uuid) => {
  const calls = [];
  return { document: { uuid, object: null }, setTarget: (...args) => calls.push(args), calls };
};

t("X releases that one token's target and keeps the rest; a token that is not targeted releases nothing", () => {
  const a = canvasToken("Scene.s.Token.a");
  const b = canvasToken("Scene.s.Token.b");
  const bucket = new Set([a, b]);
  assert.equal(untarget(bucket, "Scene.s.Token.a"), true);
  assert.deepEqual(a.calls, [[false, { releaseOthers: false }]]);
  assert.deepEqual(b.calls, []);
  assert.equal(untarget(bucket, "Scene.s.Token.none"), false);
});

/** A token document, with a canvas object that records `setTarget`. */
const tokenDoc = (uuid, { onCanvas = true } = {}) => {
  const calls = [];
  return { uuid, documentName: "Token", actor: {}, object: onCanvas ? { setTarget: (...args) => calls.push(args) } : null, calls };
};
const actorWith = (name, tokens) => ({ name, getActiveTokens: (linked, asDocument) => (assert.deepEqual([linked, asDocument], [false, true], "the viewed scene's token documents"), tokens) });

await ta("an Actor drop targets its only token on the scene, says so when there is none, and asks for the one meant when there are several", async () => {
  const one = tokenDoc("Scene.s.Token.one");
  const docs = { "Actor.a": actorWith("Brenna", [one]), "Actor.b": actorWith("Hollow", []), "Actor.c": actorWith("Twin", [tokenDoc("Scene.s.Token.t1"), tokenDoc("Scene.s.Token.t2")]) };
  const fromUuid = async (uuid) => docs[uuid] ?? null;
  assert.deepEqual(await resolveDrop({ type: "Actor", uuid: "Actor.a" }, { fromUuid }), { token: one });
  assert.deepEqual(await resolveDrop({ type: "Actor", uuid: "Actor.b" }, { fromUuid }), { notice: "noToken", name: "Hollow" });
  assert.deepEqual(await resolveDrop({ type: "Actor", uuid: "Actor.c" }, { fromUuid }), { notice: "manyTokens", name: "Twin" });
  assert.deepEqual(await resolveDrop({ type: "Actor", uuid: "Actor.gone" }, { fromUuid }), { notice: "noDrop" });
});

await ta("a Token drop is that token; anything else is no drop; targeting adds to the bucket and releases no other", async () => {
  const tok = tokenDoc("Scene.s.Token.x");
  const fromUuid = async (uuid) => (uuid === tok.uuid ? tok : null);
  assert.deepEqual(await resolveDrop({ type: "Token", uuid: tok.uuid }, { fromUuid }), { token: tok });
  assert.deepEqual(await resolveDrop({ type: "Token", uuid: "Scene.s.Token.gone" }, { fromUuid }), { notice: "noDrop" });
  assert.deepEqual(await resolveDrop({ type: "Item", uuid: "x" }, { fromUuid }), { notice: "noDrop" });
  assert.deepEqual(await resolveDrop(null, { fromUuid }), { notice: "noDrop" });
  assert.equal(addTarget(tok), true);
  assert.deepEqual(tok.calls, [[true, { releaseOthers: false }]]);
  assert.equal(addTarget(tokenDoc("Scene.o.Token.y", { onCanvas: false })), false, "a token of another scene has no canvas object to target");
  const mine = tokenDoc("Scene.s.Token.me");
  assert.deepEqual(resolveActor(actorWith("Caster", [mine])), { token: mine }, "Add my token reads the caster the same way");
});

/* ------------------------------------------------------------------ */
/*  The context a window draws, and the state it keeps                 */
/* ------------------------------------------------------------------ */

const DMG = { key: "burn", type: "damage", roll: "1d6", damage: ["fire"] };
const FEAR = { key: "fear", type: "conditionGrant", conditions: ["afraid"], lasts: "duration" };
const BOON = { key: "boon", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: 1, lasts: "duration" };
const SMASH = { key: "smash", type: "destroyItem" };
const RUNE_A = { key: "runeA", type: "modifier", target: "attackThrow", appliesTo: "recipient", value: 1, vsKinds: ["undead", "beast"], pickKind: true, lasts: "duration" };
const RUNE_B = { key: "runeB", type: "modifier", target: "damage", appliesTo: "recipient", value: 2, vsKinds: ["beast", "spirit"], pickKind: true, lasts: "duration" };

const blade = (id, name, equipped = false) => ({ id, name, type: "weapon", flags: {}, system: { equipped } });
const holderOf = (uuid, weapons, pick) => ({ uuid, weapons: weapons.map((w) => ({ id: w.id, name: w.name, magic: false })), pick });

const baseCtx = (over = {}) => ({
  modes: ["normal"],
  groups: { normal: [] },
  rows: [DMG],
  level: { value: 3, source: "class" },
  targets: [],
  holders: [],
  gaps: {},
  verdicts: { normal: [] },
  caster: { name: "Testcaster", img: "c.png" },
  spell: { name: "Testspell" },
  cite: "p. 9",
  isGM: false,
  ...over,
});

t("an effect row wears the sheet's cell in its tone: a condition is negative with its status image, a buff positive, anything else the spell's own", () => {
  const img = (id) => (id === "afraid" ? "afraid.svg" : null);
  assert.deepEqual([effectRow(FEAR, img).tone, effectRow(FEAR, img).img], ["neg", "afraid.svg"]);
  assert.deepEqual([effectRow(BOON, img).tone, effectRow(BOON, img).img, effectRow(BOON, img).icon.length > 0], ["pos", "", true], "a glyph where there is no status image");
  assert.equal(effectRow(DMG, img).tone, "neg");
  assert.equal(effectRow({ type: "heal", roll: "1d4" }, img).tone, "pos");
  assert.equal(effectRow({ type: "summon" }, img).tone, "ts");
});

t("a pick group's options are effect rows with a tone each, the chosen option marked", () => {
  const rows = [
    { key: "a1", type: "damage", roll: "1d4", damage: ["fire"], pick: "form", pickOption: "flame" },
    { key: "a2", type: "conditionGrant", conditions: ["afraid"], pick: "form", pickOption: "flame" },
    { key: "b1", type: "heal", roll: "1d6", pick: "form", pickOption: "balm" },
  ];
  const ctx = baseCtx({ rows, groups: { normal: [{ id: "form", options: [{ token: "flame", rows: [{ row: rows[0], key: "a1" }, { row: rows[1], key: "a2" }] }, { token: "balm", rows: [{ row: rows[2], key: "b1" }] }] }] } });
  const [group] = dialogContext(ctx, {}, { statusImg: (id) => (id === "afraid" ? "afraid.svg" : null) }).spell.groups;
  assert.deepEqual(group.options.map((o) => [o.key, o.selected, o.rows.map((r) => r.tone)]), [["flame", true, ["neg", "neg"]], ["balm", false, ["pos"]]]);
  assert.equal(group.options[0].rows[1].img, "afraid.svg");
  const chosen = dialogContext(ctx, { picks: { form: "balm" } }).spell.groups[0].options.map((o) => o.selected);
  assert.deepEqual(chosen, [false, true]);
  assert.deepEqual(answerOf(ctx, initialState(ctx)).picks, { form: "flame" }, "the first option answers until the seat picks another");
});

t("a re-render keeps what the seat typed: the form, picks, level, situational figure, toggle, weapons and splits come back from the state, and the bucket is read fresh", () => {
  const holder = (uuid) => holderOf(uuid, [blade("w1", "Edge", true), blade("w2", "Haft")], "w1");
  const item = { key: "bolt", row: { key: "bolt", type: "damage", delivery: "missile", roll: "1d6" }, count: { value: 3, parts: [] }, pick: "", option: "bolt", split: { A: 2, B: 1 } };
  const ctxFor = (uuids) => baseCtx({ modes: ["normal", "reversed"], groups: { normal: [], reversed: [] }, rows: [SMASH], targets: uuids.map((u) => ({ uuid: u, name: `Name ${u}` })), holders: uuids.map(holder), instances: { normal: [item], reversed: [] }, levelNeeded: true, level: { value: null }, saves: true, saveModifier: { kind: "flat", flat: -2 } });
  const state = { ...initialState(ctxFor(["A", "B"])), mode: "reversed", casterLevel: "6", situational: "2", saveMod: true, visibility: "gm", items: { A: "w2" }, allocation: { bolt: { A: "3", B: "0" } } };
  const first = dialogContext(ctxFor(["A", "B"]), { ...state, mode: "normal" });
  assert.deepEqual(first.bucket.rows.map((r) => r.pills.map((p) => p.on)), [[false, true], [true, false]], "A's pick stands, B starts on its default");
  assert.deepEqual(first.bucket.rows.map((r) => r.splits[0].value), ["3", "0"]);
  assert.equal(first.spell.level.value, "6");
  assert.equal(first.saves.situational, "2");
  assert.equal(first.saves.toggle.checked, true);
  assert.equal(first.footer.visibility.find((v) => v.selected).key, "gm");
  // A creature leaves the bucket and another joins: the answers for the one that stayed are the same, and the newcomer starts fresh.
  const second = dialogContext(ctxFor(["B", "C"]), { ...state, mode: "normal" });
  assert.deepEqual(second.bucket.rows.map((r) => r.uuid), ["B", "C"]);
  assert.deepEqual(second.bucket.rows.map((r) => r.pills.map((p) => p.on)), [[true, false], [true, false]]);
  assert.equal(second.saves.situational, "2");
  assert.equal(second.saves.toggle.checked, true);
  assert.equal(second.header.modes.find((m) => m.selected).key, "normal");
  const answer = answerOf(ctxFor(["B", "C"]), { ...state, mode: "normal" });
  assert.deepEqual(answer.items, { B: "w1", C: "w1" }, "a weapon is answered for each holder that shows a pick, and only for those present");
  assert.deepEqual(answer.allocation.bolt, { B: "0", C: "0" }, "a figure typed for a creature that left is not answered");
});

t("the save toggle (ruling 126) is one control: it carries the figure and the page when imported, is disabled with the page alone when not, and its figure is read at the level typed", () => {
  const ctx = baseCtx({ saves: true, saveModifier: { kind: "flat", flat: -2 }, saveParts: [{ label: "Ability", value: 1 }] });
  const on = dialogContext(ctx, { saveMod: true, situational: "2" }).saves;
  assert.deepEqual([on.toggle.checked, on.toggle.disabled], [true, false]);
  assert.match(on.toggle.tip, /tip\.saveModifier\|.*-2.*p\. 9/);
  assert.deepEqual(on.parts.map((p) => [p.label.split("|")[0], p.value]), [["ACKS-MAGIC.cast.dialog.situational", "+2"], ["Testspell", "-2"], ["Ability", "+1"]], "the parts that stand, live");
  const off = dialogContext(ctx, { saveMod: false }).saves;
  assert.deepEqual(off.parts.map((p) => p.label), ["Ability"]);
  const blank = dialogContext({ ...ctx, saveModifier: null }, { saveMod: true }).saves;
  assert.deepEqual([blank.toggle.checked, blank.toggle.disabled, blank.toggle.tip], [false, true, "p. 9"], "nothing imported: disabled, unchecked, the page reference alone");
  const scaled = { saveModifier: { kind: "perLevel", base: 0, per: 1 }, levelNeeded: true, level: { value: null }, levelAt: (typed) => ({ value: Number(typed) || null }) };
  assert.equal(dialogContext({ ...ctx, ...scaled }, { saveMod: true, casterLevel: "" }).saves.toggle.disabled, true, "a figure per level waits for a level");
  assert.equal(dialogContext({ ...ctx, ...scaled }, { saveMod: true, casterLevel: "4" }).saves.toggle.disabled, false, "and is read once one is typed");
  assert.equal(answerOf(ctx, { ...initialState(ctx), saveMod: true }).saveMod, true);
  assert.equal(dialogContext(baseCtx({ saves: false })).saves.show, false);
});

t("the weapon pick (ruling 124) shows for every holder where a row destroys a weapon, with a note for a holder with none, and answers the pick per holder", () => {
  const ctx = baseCtx({
    rows: [SMASH],
    targets: [{ uuid: "A", name: "Armed" }, { uuid: "B", name: "Bare" }],
    holders: [holderOf("A", [blade("w1", "Edge", true), blade("w2", "Haft")], "w1"), holderOf("B", [], "")],
  });
  const view = dialogContext(ctx, { items: { A: "w2" } });
  assert.deepEqual(view.bucket.rows[0].pills.map((p) => [p.id, p.on]), [["w1", false], ["w2", true]]);
  assert.deepEqual([view.bucket.rows[1].pills.length, view.bucket.rows[1].noWeapon], [0, true]);
  assert.deepEqual(answerOf(ctx, { ...initialState(ctx), items: { A: "w2" } }).items, { A: "w2" }, "a holder with no weapon answers none");
  assert.deepEqual(answerOf(baseCtx({ ...ctx, rows: [DMG] }), initialState(ctx)).items, {}, "no row asks for a weapon, so none is answered");
});

t("the creature-kind pick (ruling 139) is one select over the union of the rows' authored kinds, each once, narrowing to the seat's pick and defaulting to the first", () => {
  const kept = [RUNE_A, RUNE_B].map((row, i) => ({ row, key: row.key, index: i }));
  assert.deepEqual(kindChoices(kept), ["undead", "beast", "spirit"]);
  assert.deepEqual(kindChoices([{ row: { ...RUNE_A, pickKind: false } }, { row: BOON }]), [], "a row that picks no kind offers none");
  const ctx = baseCtx({ rows: [RUNE_A, RUNE_B] });
  const view = dialogContext(ctx, { pickKind: "spirit" }).spell;
  assert.deepEqual(view.kind.options.map((o) => [o.key, o.selected]), [["undead", false], ["beast", false], ["spirit", true]]);
  assert.equal(view.kind.rows.length, 2, "each row the pick narrows is shown as an effect row");
  assert.equal(answerOf(ctx, { ...initialState(ctx), pickKind: "spirit" }).pickKind, "spirit");
  assert.equal(answerOf(ctx, initialState(ctx)).pickKind, "undead", "the first kind stands until the seat picks");
  assert.equal(answerOf(ctx, { ...initialState(ctx), pickKind: "ghost" }).pickKind, "undead", "a kind no row authored is not an answer");
  assert.equal(answerOf(baseCtx({ rows: [BOON] }), initialState(ctx)).pickKind, null, "no row picks a kind, so none is answered");
  assert.equal(dialogContext(baseCtx({ rows: [BOON] })).spell.kind.show, false);
});

t("the bucket's count and rows carry their provenance: n of the cap with the page, a gap in feet with a tooltip, a gated target quiet with the gate's reason, a pending own-save chip", () => {
  const ctx = baseCtx({
    targets: [{ uuid: "A", name: "Near" }, { uuid: "B", name: "Far" }, { uuid: "C", name: "Immune" }],
    gaps: { A: 10, B: 80, C: null },
    reachAt: () => ({ count: 2, range: { limit: 40, parts: [{ key: "perLevel", value: 10 }], out: [{ key: "B", name: "Far", gap: 80 }], unmeasured: true } }),
    gatesAt: () => ({ C: { affected: false, why: { key: "hd", parts: [{ key: "hd", value: 9 }, { key: "cap", value: 4 }] } } }),
    pendingAt: () => ({ A: ["Testrow"] }),
    verdictsAt: () => [{ key: "tooManyTargets", severity: "block", max: 2, over: 1 }],
  });
  const { bucket, footer } = dialogContext(ctx, {});
  assert.deepEqual([bucket.count.n, bucket.count.max, bucket.count.over], [3, 2, true]);
  assert.match(bucket.count.text, /dialog\.count\|.*"n":3.*"max":2/);
  assert.match(bucket.count.tip, /tip\.cite\|.*p\. 9/);
  assert.deepEqual(bucket.rows.map((r) => [!r.line.includes("gapUnknown"), r.far, r.off]), [[true, false, false], [true, true, false], [false, false, true]]);
  assert.match(bucket.rows[0].tip, /tip\.gap\|/);
  assert.match(bucket.rows[1].tip, /tip\.range\|/);
  assert.match(bucket.rows[2].tip, /tip\.gateHd\|/, "an unaffected target says which gate");
  assert.match(bucket.rows[0].chips[0].tip, /Testrow/);
  assert.match(bucket.rows[0].removeLabel, /dialog\.remove\|.*Near/);
  assert.equal(footer.blocked, true, "over the cap a Player is blocked");
  const judge = dialogContext({ ...ctx, isGM: true, verdictsAt: () => [{ key: "tooManyTargets", severity: "warn", max: 2, over: 1 }] }, {}).footer;
  assert.deepEqual([judge.blocked, judge.verdicts[0].severity], [false, "warn"], "a Judge is warned and not stopped");
  assert.equal(dialogContext(baseCtx(), {}).bucket.empty, true);
});

/* ------------------------------------------------------------------ */
/*  The window                                                         */
/* ------------------------------------------------------------------ */

/** A cast context whose `refresh` reads a bucket the test controls. */
const liveCtx = (box, over = {}) => {
  const make = () => baseCtx({ rows: [SMASH], targets: box.uuids.map((u) => ({ uuid: u, name: `Name ${u}` })), holders: box.uuids.map((u) => holderOf(u, [blade("w1", "Edge", true), blade("w2", "Haft")], "w1")), refresh: () => (box.reads++, make()), ...over });
  return make();
};

await ta("a declaration reopened at the turn starts the window on the declared answer, copied, and the bucket re-read keeps it", async () => {
  CastDialog.instances.length = 0;
  hooks.clear();
  const initial = { mode: "normal", picks: {}, pickKind: "", items: { A: "w2" }, allocation: { bolt: { A: "2", B: "1" } }, casterLevel: "5", situational: 2, saveMod: true, visibility: "blind", targets: ["A", "B"] };
  const start = initialState(baseCtx({ initial }), { visibility: "public" });
  assert.deepEqual([start.items, start.allocation, start.casterLevel, start.situational, start.saveMod, start.visibility], [{ A: "w2" }, { bolt: { A: "2", B: "1" } }, "5", 2, true, "blind"]);
  assert.notEqual(start.items, initial.items, "the stored record is copied, never written through");
  assert.notEqual(start.allocation.bolt, initial.allocation.bolt);
  assert.equal(initialState(baseCtx(), { visibility: "gm" }).visibility, "gm", "no declaration: the fresh answer");
  const box = { uuids: ["A"], reads: 0 };
  const asked = CastDialog.wait(liveCtx(box, { initial }));
  await settle(5);
  const [dialog] = CastDialog.instances;
  assert.deepEqual([dialog.last.saves.situational, dialog.last.saves.toggle.checked, dialog.last.footer.visibility.find((v) => v.selected).key], [2, false, "blind"], "the figure and the visibility come back (the toggle waits on an imported figure)");
  assert.equal(dialog.last.bucket.rows[0].pills.find((p) => p.on).id, "w2", "the declared weapon is the one picked");
  box.uuids = ["A", "C"];
  fire("targetToken", game.user, {}, true);
  await settle();
  assert.equal(dialog.last.footer.visibility.find((v) => v.selected).key, "blind", "a re-read of the bucket does not apply the declaration again");
  await dialog.close();
  assert.equal(await asked, null);
});

await ta("the window answers null on close, hooks the seat's own target changes while open, and unhooks on close", async () => {
  CastDialog.instances.length = 0;
  hooks.clear();
  const box = { uuids: ["A"], reads: 0 };
  const asked = CastDialog.wait(liveCtx(box));
  await settle(5);
  const [dialog] = CastDialog.instances;
  assert.equal(dialog.rendered, 1);
  assert.deepEqual([...hooks.values()].map((h) => h.name), ["targetToken"]);
  fire("targetToken", { id: "other" }, {}, true);
  await settle();
  assert.equal(box.reads, 0, "another user's target changes are not the bucket's");
  box.uuids = ["A", "B"];
  fire("targetToken", game.user, {}, true);
  fire("targetToken", game.user, {}, false);
  await settle();
  assert.equal(box.reads, 1, "a burst reads the bucket once");
  assert.equal(dialog.rendered, 2);
  assert.deepEqual(dialog.last.bucket.rows.map((r) => r.uuid), ["A", "B"]);
  await dialog.close();
  assert.equal(await asked, null, "a closed window answers null");
  assert.equal(hooks.size, 0, "and unhooks");
  fire("targetToken", game.user, {}, true);
  await settle();
  assert.equal(dialog.rendered, 2, "a closed window draws no more");
});

await ta("X, a drop, Add my token and a weapon pick work through the window's own actions, and the pick survives the bucket changing", async () => {
  CastDialog.instances.length = 0;
  hooks.clear();
  const a = canvasToken("A");
  game.user.targets = new Set([a]);
  const box = { uuids: ["A", "B"], reads: 0 };
  const mine = tokenDoc("Scene.s.Token.me");
  const asked = CastDialog.wait(liveCtx(box, { caster: { name: "Testcaster", getActiveTokens: () => [mine] } }));
  await settle(5);
  const [dialog] = CastDialog.instances;
  const actions = CastDialog.DEFAULT_OPTIONS.actions;
  actions.pickWeapon.call(dialog, {}, { dataset: { uuid: "A", weapon: "w2" } });
  await settle(5);
  assert.deepEqual(dialog.last.bucket.rows[0].pills.map((p) => p.on), [false, true]);
  actions.untarget.call(dialog, {}, { dataset: { uuid: "A" } });
  assert.deepEqual(a.calls, [[false, { releaseOthers: false }]], "X releases the seat's own target");
  await settle();
  assert.equal(dialog.last.bucket.rows[0].pills[1].on, true, "the pick is the state's, not the DOM's, so it survives the re-read");
  actions.addMine.call(dialog, {}, {});
  assert.deepEqual(mine.calls, [[true, { releaseOthers: false }]], "Add my token targets the caster's token");
  await dialog.close();
  assert.equal(await asked, null);
});

await ta("Cast answers the state once, a blocked Player's Cast answers nothing, and Cancel answers null", async () => {
  CastDialog.instances.length = 0;
  const box = { uuids: ["A"], reads: 0 };
  const asked = CastDialog.wait(liveCtx(box));
  await settle(5);
  const [dialog] = CastDialog.instances;
  const { actions } = CastDialog.DEFAULT_OPTIONS;
  actions.pickWeapon.call(dialog, {}, { dataset: { uuid: "A", weapon: "w2" } });
  actions.cast.call(dialog, {}, {});
  const answer = await asked;
  assert.deepEqual([answer.mode, answer.items, answer.pickKind, answer.saveMod], ["normal", { A: "w2" }, null, false]);
  assert.equal(dialog.closed, true);

  CastDialog.instances.length = 0;
  const stopped = CastDialog.wait(liveCtx(box, { verdictsAt: () => [{ key: "noSlot", severity: "block" }] }));
  await settle(5);
  const [blocked] = CastDialog.instances;
  actions.cast.call(blocked, {}, {});
  assert.equal(blocked.closed, false, "a Player with a blocking verdict cannot cast");
  actions.cancel.call(blocked, {}, {});
  assert.equal(await stopped, null);
});

/* ------------------------------------------------------------------ */
/*  The cast reads the bucket after the answer                         */
/* ------------------------------------------------------------------ */

const creature = (name) => ({ name, type: "monster", system: { hp: { hd: "2" }, saves: { spell: { value: 14 } } }, effects: [], getFlag: () => undefined, items: Object.assign([blade(`w-${name}`, `${name} edge`, true), blade(`x-${name}`, `${name} haft`)], { get(id) { return this.find((i) => i.id === id); } }) });
const tokenOf = (name, i) => ({ uuid: `Scene.s.Token.${i}`, name, id: `t${i}`, actor: creature(name) });

/** The deps of a cast whose seat's bucket is `box.tokens`, changed by the dialog's own answer. */
function runDeps(box, answerFn) {
  const calls = { posts: [], asked: null, reads: 0 };
  return {
    calls,
    deps: {
      lookups: { byCookbookId: () => null, fromUuidSync: () => null },
      read: async () => ({ actor: {}, casterToken: null, statuses: [], capacity: { verdict: "ok" }, level: { matched: true, classLevel: 4 } }),
      targets: () => (calls.reads++, { tokens: box.tokens, gaps: {} }),
      ask: async (ctx) => ((calls.asked = ctx), answerFn(ctx)),
      notify: () => {},
      adjustPool: async () => {},
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => (calls.posts.push(c), { id: "m1", flags: { "acks-extras": { castCard: c } } }),
      apply: async () => ({ ok: true }),
      record: async () => {},
      throwRow: async () => null,
      now: () => 10,
      isGM: () => false,
    },
  };
}
const spellOf = (rows, extra = {}) => ({ type: "spell", name: "Testsmash", uuid: "Actor.c1.Item.s1", img: "i.png", flags: { "acks-extras": { spell: { save: { category: "spell", effect: "negates" }, effects: rows, ...extra } } }, parent: { isOwner: true, type: "character", uuid: "Actor.c1", name: "Caster" } });

await ta("the cast reads the seat's targets again once the dialog is answered, so a target added or removed there is the one the card carries; each holder's destroy entry names the weapon picked for it", async () => {
  const first = tokenOf("Ant", 1);
  const second = tokenOf("Bee", 2);
  const box = { tokens: [first] };
  const r = runDeps(box, (ctx) => {
    assert.deepEqual(ctx.targets.map((t) => t.uuid), [first.uuid], "the dialog opens on the bucket as it stands");
    box.tokens = [first, second];
    return { mode: "normal", picks: {}, items: { [first.uuid]: "x-Ant", [second.uuid]: "w-Bee" }, allocation: {}, saveMod: false };
  });
  const out = await castSpellRun(spellOf([SMASH]), () => {}, r.deps);
  assert.equal(out.ok, true);
  const card = r.calls.posts[0];
  assert.deepEqual(Object.values(card.targets).map((tgt) => tgt.uuid), [first.uuid, second.uuid], "the second target was added while the dialog was open");
  assert.deepEqual(Object.values(card.entries).map((e) => e.item.id), ["x-Ant", "w-Bee"], "each holder's own pick");
  assert.ok(r.calls.reads >= 2, "once for the dialog and once after the answer");
  const asked = r.calls.asked;
  assert.deepEqual(asked.holders.map((h) => [h.uuid, h.pick]), [[first.uuid, "w-Ant"]], "a holder's pick starts on its equipped weapon");
  assert.equal(asked.refresh().targets.length, 2, "the context's refresh reads the bucket again");
});

await ta("a pickKind cast narrows its rows to the kind the dialog answered, and the card says which", async () => {
  const box = { tokens: [tokenOf("Ant", 1)] };
  const r = runDeps(box, () => ({ mode: "normal", picks: {}, pickKind: "spirit", items: {}, allocation: {} }));
  await castSpellRun(spellOf([RUNE_A, RUNE_B]), () => {}, r.deps);
  assert.deepEqual(r.calls.posts[0].pickKind, { key: "spirit", defaulted: false });
});

console.log(`\n${n} cast dialog tests passed`);
