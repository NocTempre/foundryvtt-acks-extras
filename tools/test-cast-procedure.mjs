/**
 * The cast's per-tradition procedure seam, offline (`cast-procedure.mjs` and the
 * places the cast reads it): the registry, the claims, a long casting time in a
 * fight, the verdicts and their severity, the Invocation band the dialog draws,
 * `perform`'s place in the cast, what a declaration stores and a resolution
 * restores, the Judge's revert, a lost declaration, a stored bucket the world no
 * longer holds, and a ritual. Foundry-free; the tradition kind, the procedure,
 * the spells and every figure are invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-procedure.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) }, applications: { handlebars: { loadTemplates: async () => {} } } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key } };
const order = [];
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    order.push("roll");
    this.total = 7;
    this.result = "7";
    return this;
  }
};
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.fromUuidSync = () => null;
globalThis.fromUuid = async () => null;

const { registerCastProcedure, procedureFor, procedureOfKind, spellProcedureKind, runPerform, runRevert, runLost, procedureView, storedProcedure, normalizeBuckets, bucketUuids } = await import("../scripts/magic/cast-procedure.mjs");
const { castMoment, longerThanRound, MOMENT } = await import("../scripts/magic/cast-moment.mjs");
const { castVerdicts, blocked } = await import("../scripts/magic/cast-plan.mjs");
const { castSpellRun, castSpellClaims, castSpellClaimant, castTimeOf } = await import("../scripts/magic/cast-spell.mjs");
const { castSummonClaimant } = await import("../scripts/magic/cast-summon.mjs");
const { answerStored, answerFromPending, ANSWER_FIELDS } = await import("../scripts/magic/cast-declare.mjs");
const { castCardView, CARD_ACTIONS } = await import("../scripts/magic/cast-card.mjs");
const { dialogContext, answerOf, initialState } = await import("../scripts/magic/apps/cast-dialog-model.mjs");
const Handlebars = (await import("handlebars")).default;

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

const KIND = "testkind";
const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };
const heal = (over = {}) => ({ key: "mend", type: "heal", roll: "1d4", ...over });
const tradition = { key: "wisp", label: "Wisp", kind: KIND, slots: [], spellList: [] };
const classItem = { system: { casting: [tradition], ladders: [] } };
const classFor = () => classItem;
const spell = (rows, extra = {}, over = {}) => ({
  type: "spell",
  name: "Testrite",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  system: { lvl: 1, class: "" },
  flags: { "acks-extras": { spell: { lists: [{ source: "wisp", level: 1 }], effects: rows, ...extra } } },
  parent: { isOwner: true, type: "character", uuid: "Actor.c1", name: "Tester" },
  ...over,
});
const FIELDS = [
  { key: "pace", kind: "select", label: "Pace", choices: [{ value: "calm", label: "Calm" }, { value: "hasty", label: "Hasty" }, { value: "slow", label: "Slow" }], initial: "calm" },
  { key: "bonus", kind: "number", label: "Bonus", min: 0, max: 5, initial: 0 },
];

/** A procedure that logs what it was asked, and the members a test overrides. */
function logging(over = {}) {
  const log = { performs: [], verdicts: [], times: [], reverts: [], losts: [] };
  const procedure = {
    fields: () => FIELDS,
    verdicts: (ctx, answer) => (log.verdicts.push({ ctx, answer }), answer.pace === "hasty" ? [{ key: "tooHasty", notice: "Too hasty here." }] : []),
    castingTime: (ctx, answer) => (log.times.push({ ctx, answer }), answer.pace === "slow" ? { shape: "timed", value: 3, unit: "turns" } : null),
    perform: async (ctx, answer) => (order.push("perform"), log.performs.push({ ctx, answer }), { proceed: true, section: { title: "Rite", rows: [{ name: "Tester", total: 4 }] }, rolls: [], undo: { marks: 2 } }),
    lost: async (ctx, declaration) => void log.losts.push({ ctx, declaration }),
    revert: async (ctx, undo) => void log.reverts.push({ ctx, undo }),
    ...over,
  };
  return { log, procedure };
}

/** The deps one cast runs on. `read` carries the tradition, so the procedure is found as it is live. */
function runDeps({ answer, isGM = false, tradition: trad = tradition, cap = null, declared = null, holds = null } = {}) {
  const calls = { notices: [], texts: [], posts: [], records: [], applied: [], asked: null, declares: [], spends: 0 };
  const deps = {
    lookups: NO_TWIN,
    read: async () => ({ actor: {}, tokens: [], casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: false }, cap, tradition: trad, classItem, ...(declared ?? {}) }),
    ask: async (ctx) => ((calls.asked = ctx), answer),
    notify: (lvl, key) => calls.notices.push([lvl, key]),
    notifyText: (lvl, text) => calls.texts.push([lvl, text]),
    adjustPool: async () => {},
    castId: () => (order.push("castId"), "castX"),
    roll: () => 1,
    post: async (c, o) => (calls.posts.push({ card: c, options: o }), { id: "m1", flags: { "acks-extras": { castCard: c } } }),
    apply: async (...args) => calls.applied.push(args),
    record: async (c, data) => calls.records.push(data),
    throwRow: async () => null,
    now: () => 10,
    isGM: () => isGM,
    endHeld: async () => {},
    declare: { declare: async (from) => (calls.declares.push(from), { castId: "d1" }), finish: async () => {}, clearHand: async () => {} },
    ...(holds ? { holds } : {}),
  };
  return { calls, deps };
}

const fight = (combatantId, over = {}) => ({ combat: { id: "k1", started: true, round: 1, turn: 1, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: combatantId }, ...over }, combatant: { id: "cb1", initiative: 9 } });
const cast = async (item, deps, spend = () => {}) => castSpellRun(item, spend, deps);
const keysOf = (verdicts) => verdicts.map((v) => [v.key, v.severity]);

/* ------------------------------------------------------------------ */
/*  The registry                                                      */
/* ------------------------------------------------------------------ */

t("one procedure stands per kind: registration returns its off, a second replaces the first and the first's off then does nothing", () => {
  const a = { fields: () => [] };
  const b = { verdicts: () => [] };
  const offA = registerCastProcedure(KIND, a);
  assert.equal(procedureFor({ tradition }).fields, a.fields);
  const offB = registerCastProcedure(KIND, b);
  assert.equal(procedureOfKind(KIND).verdicts, b.verdicts, "the second replaced the first");
  offA();
  assert.ok(procedureOfKind(KIND), "a stale handle takes nothing down");
  offB();
  assert.equal(procedureOfKind(KIND), null, "its own handle removes it");
  offB();
  assert.equal(procedureFor({ tradition }), null);
  assert.equal(procedureFor({}), null);
  assert.equal(procedureFor(null), null);
});

t("a registration with no kind, no object or a member that is no function is refused; a kind with no members registers", () => {
  assert.throws(() => registerCastProcedure("", {}), TypeError);
  assert.throws(() => registerCastProcedure(KIND, null), TypeError);
  assert.throws(() => registerCastProcedure(KIND, { perform: "no" }), TypeError);
  const off = registerCastProcedure(KIND, {});
  assert.ok(procedureOfKind(KIND));
  off();
});

t("a ctx whose source is not a spell is never given a procedure", () => {
  const off = registerCastProcedure(KIND, { fields: () => [] });
  assert.ok(procedureFor({ source: "spell", tradition }));
  assert.ok(procedureFor({ tradition }), "no source reads as a spell");
  assert.equal(procedureFor({ source: "trinket", tradition }), null);
  off();
});

t("the stored answer is plain data: buckets are normalized, an entry that names no document is dropped, and what is no object is none", () => {
  assert.deepEqual(normalizeBuckets({ a: [{ uuid: "Item.1", qty: 2, fit: "x" }, { uuid: "" }, { qty: 3 }, null], b: "no" }), { a: [{ uuid: "Item.1", qty: 2, fit: "x" }] });
  assert.deepEqual(normalizeBuckets({ a: [{ uuid: "Item.1" }] }), { a: [{ uuid: "Item.1", qty: 1, fit: "" }] }, "a quantity that is no figure is one");
  assert.deepEqual(bucketUuids({ buckets: { a: [{ uuid: "I.1" }, { uuid: "I.2" }], b: [{ uuid: "I.1" }] } }), ["I.1", "I.2"]);
  const stored = storedProcedure({ pace: "calm", gone: undefined, buckets: { a: [{ uuid: "I.1", qty: 0 }] } });
  assert.deepEqual(stored, { pace: "calm", buckets: { a: [{ uuid: "I.1", qty: 1, fit: "" }] } });
  for (const bad of [null, undefined, "x", 3, [1]]) assert.equal(storedProcedure(bad), null);
});

/* ------------------------------------------------------------------ */
/*  Claims                                                            */
/* ------------------------------------------------------------------ */

t("a flagged spell whose tradition has a procedure is claimed with rows or without; one whose tradition has none is claimed only with rows", () => {
  const rowless = spell([]);
  assert.equal(castSpellClaims(rowless, NO_TWIN, classFor), false, "no procedure registered: a rowless spell stays the system's");
  const off = registerCastProcedure(KIND, {});
  assert.equal(castSpellClaims(rowless, NO_TWIN, classFor), true, "a procedure claims it with no rows");
  assert.equal(castSpellClaims(spell([heal()]), NO_TWIN, classFor), true);
  assert.equal(castSpellClaims(rowless, NO_TWIN), false, "with no class reader no procedure is found");
  assert.equal(castSpellClaims(rowless, NO_TWIN, () => ({ system: { casting: [{ key: "wisp", kind: "other" }] } })), false, "another kind has none");
  assert.equal(castSpellClaims(rowless, NO_TWIN, () => null), false);
  assert.equal(castSpellClaims(spell([], {}, { parent: { isOwner: false } }), NO_TWIN, classFor), false, "an actor this seat does not own");
  assert.equal(castSpellClaims({ ...rowless, flags: {} }, NO_TWIN, classFor), false, "an unflagged item");
  assert.equal(castSpellClaims({ ...rowless, type: "weapon" }, NO_TWIN, classFor), false);
  assert.equal(castSpellClaimant({ lookups: NO_TWIN }, { classFor }).claims(rowless), true, "the claimant reads the class reader it is given");
  assert.equal(spellProcedureKind(rowless, classFor), KIND);
  off();
  assert.equal(castSpellClaims(rowless, NO_TWIN, classFor), false, "removed, it claims nothing again");
});

t("a summoning spell with a procedure is the spell claimant's and not the summoning's; one without stays the summoning's, and the spell claimant still declines it", () => {
  const summon = spell([heal(), { type: "summon", ref: "def.invented.x" }]);
  const off = registerCastProcedure(KIND, {});
  assert.equal(castSpellClaims(summon, NO_TWIN, classFor), true, "summoning() is ignored for a spell with a procedure");
  assert.equal(castSummonClaimant(undefined, { classFor }).claims(summon), false, "the summoning declines it");
  assert.equal(castSummonClaimant(undefined, {}).claims(summon), true, "with no class reader the summoning keeps it, as before");
  off();
  assert.equal(castSpellClaims(summon, NO_TWIN, classFor), false);
  assert.equal(castSummonClaimant(undefined, { classFor }).claims(summon), true);
});

/* ------------------------------------------------------------------ */
/*  A long casting time                                               */
/* ------------------------------------------------------------------ */

t("a casting time is longer than a round by its unit: more than one round, or any other unit; nothing else is", () => {
  const timed = (value, unit) => ({ shape: "timed", value, unit });
  assert.equal(longerThanRound(timed(2, "rounds")), true);
  assert.equal(longerThanRound(timed(1, "rounds")), false);
  assert.equal(longerThanRound(timed(null, "rounds")), false);
  for (const unit of ["turns", "minutes", "hours", "days", "weeks", "months", "years"]) assert.equal(longerThanRound(timed(1, unit)), true, unit);
  assert.equal(longerThanRound(timed(3, "")), false, "no unit");
  assert.equal(longerThanRound(timed(3, "fortnights")), false, "a unit the vocabulary lacks");
  for (const shape of ["action", "round", "special"]) assert.equal(longerThanRound({ shape, value: 9, unit: "days" }), false, shape);
  assert.equal(longerThanRound(null), false);
});

t("a begun fight makes a time longer than a round `long`; with no fight it is free, and a short time is declared or resolved as before", () => {
  const { combat, combatant } = fight("cb2");
  const long = { shape: "timed", value: 1, unit: "turns" };
  assert.equal(castMoment({ combat, combatant, castingTime: long }), MOMENT.long);
  assert.equal(castMoment({ combat, combatant }), MOMENT.declare);
  assert.equal(castMoment({ combat, combatant, castingTime: { shape: "round" } }), MOMENT.declare);
  assert.equal(castMoment({ combat: fight("cb1").combat, combatant, castingTime: long }), MOMENT.long, "at the caster's own turn too");
  assert.equal(castMoment({ combat: fight("cb1").combat, combatant }), MOMENT.resolve);
  assert.equal(castMoment({ combat: null, combatant: null, castingTime: long }), MOMENT.free, "no fight: free");
  assert.equal(castMoment({ combat: { started: false, flags: {} }, combatant, castingTime: long }), MOMENT.free, "a fight not begun");
});

t("the casting time of a spell is its own flag's, else its library twin's", () => {
  const own = spell([], { castingTime: { shape: "timed", value: 2, unit: "turns" } });
  assert.deepEqual(castTimeOf(own, NO_TWIN), { shape: "timed", value: 2, unit: "turns" });
  const bare = spell([], {}, {});
  bare.flags["acks-extras"].cookbook = { id: "def.spell.testRite" };
  const twin = { flags: { "acks-extras": { spell: { castingTime: { shape: "timed", value: 1, unit: "hours" } } } } };
  assert.equal(castTimeOf(bare, { byCookbookId: () => twin }).unit, "hours");
  assert.equal(castTimeOf(bare, NO_TWIN), null);
});

/* ------------------------------------------------------------------ */
/*  Verdicts                                                          */
/* ------------------------------------------------------------------ */

t("a procedure's findings, a long cast, a ritual and a gone bucket entry take their severity from the plan: a Player is blocked and a Judge warned", () => {
  const base = { capacity: { verdict: "ok" } };
  const found = [{ key: "tooHasty", notice: "Too hasty here." }];
  assert.deepEqual(keysOf(castVerdicts({ ...base, procedure: found })), [["tooHasty", "block"]]);
  assert.deepEqual(keysOf(castVerdicts({ ...base, procedure: found, isGM: true })), [["tooHasty", "warn"]]);
  assert.equal(castVerdicts({ ...base, procedure: found })[0].notice, "Too hasty here.", "the procedure's own words ride along");
  assert.deepEqual(keysOf(castVerdicts({ ...base, moment: MOMENT.long })), [["longCast", "block"]]);
  assert.deepEqual(keysOf(castVerdicts({ ...base, moment: MOMENT.long, isGM: true })), [["longCast", "warn"]]);
  assert.deepEqual(keysOf(castVerdicts({ ...base, ritual: true })), [["ritualPending", "block"]]);
  assert.deepEqual(keysOf(castVerdicts({ ...base, ritual: true, isGM: true })), [["ritualPending", "warn"]]);
  assert.deepEqual(keysOf(castVerdicts({ ...base, bucketsGone: ["Item.gone"] })), [["bucketChanged", "block"]]);
  assert.deepEqual(keysOf(castVerdicts({ ...base, bucketsGone: ["Item.gone"], isGM: true })), [["bucketChanged", "warn"]]);
  assert.deepEqual(castVerdicts(base), [], "none given, none drawn");
  assert.equal(blocked(castVerdicts({ ...base, procedure: found })), true);
  assert.equal(blocked(castVerdicts({ ...base, procedure: found, isGM: true })), false);
});

/* ------------------------------------------------------------------ */
/*  The Invocation band                                               */
/* ------------------------------------------------------------------ */

/** The dialog's context for a tradition with the given procedure, the way the cast hands it over. */
function dialogCtx(procedure, over = {}) {
  const ctx = { kind: KIND };
  return {
    spell: { name: "Testrite" },
    caster: { name: "Tester", img: "" },
    modes: ["normal"],
    rows: [],
    groups: { normal: [] },
    level: { value: 3, source: "class" },
    saves: null,
    targets: [],
    moment: MOMENT.free,
    verdicts: { normal: [] },
    procedure: { kind: KIND, at: (mode, raw) => procedureView(procedure, ctx, raw) },
    ...over,
  };
}

t("the procedure's fields and its band are one Invocation band, between the spell and the saves, and what the seat answers reads back under `procedure`", () => {
  const { procedure } = logging({ band: (ctx, answer) => ({ template: "test/band.hbs", context: { label: `pace ${answer.pace}` } }) });
  const ctx = dialogCtx(procedure, { saves: {}, levelNeeded: true });
  const view = dialogContext(ctx, { procedure: { pace: "hasty" } });
  assert.equal(view.invocation.show, true);
  assert.deepEqual(view.invocation.fields.map((f) => [f.name, f.isSelect, f.isNumber, f.value]), [["procedure.pace", true, false, "hasty"], ["procedure.bonus", false, true, 0]]);
  assert.deepEqual(view.invocation.fields[0].choices.map((c) => [c.value, c.selected]), [["calm", false], ["hasty", true], ["slow", false]]);
  assert.deepEqual(view.invocation.band, { template: "test/band.hbs", context: { label: "pace hasty" } });
  Handlebars.registerHelper("localize", (key) => key);
  Handlebars.registerPartial("test/band.hbs", `<div class="band-probe">{{label}}</div>`);
  const html = Handlebars.compile(fs.readFileSync(new URL("../templates/magic/cast-dialog.hbs", import.meta.url), "utf8"))({ ...view, saves: { ...view.saves, show: true } });
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('name="procedure.pace"') > 0 && at('name="procedure.bonus"') > 0, "both fields are drawn");
  assert.ok(at('class="band-probe">pace hasty') > 0, "and the band's partial with its context");
  assert.equal(html.split("cast.dialog.invocation").length - 1, 1, "one Invocation heading, not one per part");
  assert.ok(at("cast-saves") > at("band-probe") && at("band-probe") > at('name="procedure.bonus"') && at('name="procedure.bonus"') > at("cast.dialog.invocation"), "fields, then band, under one heading, before the saves");
  const answer = answerOf(ctx, { procedure: { pace: "hasty", bonus: "9", extra: "kept" } });
  assert.deepEqual(answer.procedure, { pace: "hasty", bonus: 5, extra: "kept" }, "coerced to the fields (a figure over the cap is held to it), with a control the specs do not name kept");
  assert.deepEqual(answerOf(ctx, {}).procedure, { pace: "calm", bonus: 0 }, "a blank answer stands on each field's initial");
});

t("a tradition with no procedure has no Invocation band and answers no procedure; a reopened declaration prefills the answer as a copy", () => {
  const plain = dialogCtx(null, { procedure: null });
  assert.equal(dialogContext(plain, {}).invocation.show, false);
  assert.deepEqual(answerOf(plain, { procedure: { pace: "hasty" } }).procedure, {});
  const initial = { procedure: { pace: "hasty", buckets: { a: [{ uuid: "I.1", qty: 1, fit: "" }] } } };
  const state = initialState({ ...plain, initial });
  assert.deepEqual(state.procedure, initial.procedure);
  state.procedure.pace = "calm";
  assert.equal(initial.procedure.pace, "hasty", "the stored record is never written through");
  const field = dialogContext(dialogCtx({ fields: () => [{ key: "q", kind: "boolean", label: "Q", initial: false }] }), { procedure: { q: true } }).invocation.fields[0];
  assert.deepEqual([field.isCheck, field.checked], [true, true]);
});

t("the footer reads a procedure's finding in its own words, and the casting time the seat's answer gives moves the button and the hint", () => {
  const { procedure } = logging();
  const verdictsAt = (mode, picks, level, typed, inv, praw) => castVerdicts({ capacity: { verdict: "ok" }, procedure: praw?.pace === "hasty" ? [{ key: "tooHasty", notice: "Too hasty here." }] : [] });
  const momentAt = (mode, level, praw) => (praw?.pace === "slow" ? MOMENT.long : MOMENT.declare);
  const ctx = dialogCtx(procedure, { moment: MOMENT.declare, verdictsAt, momentAt });
  const hasty = dialogContext(ctx, { procedure: { pace: "hasty" } });
  assert.deepEqual(hasty.footer.verdicts.map((v) => [v.severity, v.text]), [["block", "Too hasty here."]]);
  assert.equal(hasty.footer.blocked, true);
  assert.equal(hasty.footer.cast, "ACKS-MAGIC.cast.dialog.declare|{}");
  assert.ok(hasty.declaring);
  const slow = dialogContext(ctx, { procedure: { pace: "slow" } });
  assert.equal(slow.footer.cast, "ACKS-MAGIC.cast.dialog.cast|{}", "a long cast is cast, not declared");
  assert.equal(slow.declaring, "");
});

/* ------------------------------------------------------------------ */
/*  The cast                                                          */
/* ------------------------------------------------------------------ */

await ta("a cast under a tradition with a procedure asks the dialog for its fields and band, and a verdict of the procedure's refuses a Player before the spend and warns a Judge in the procedure's words", async () => {
  const { procedure, log } = logging({ band: () => ({ template: "test/band.hbs", context: {} }) });
  const off = registerCastProcedure(KIND, procedure);
  let r = runDeps({ answer: { mode: "normal", picks: {}, procedure: { pace: "hasty" } } });
  const refused = await cast(spell([heal()]), r.deps, () => r.calls.spends++);
  assert.deepEqual([refused.ok, refused.reason, r.calls.spends], [false, "tooHasty", 0]);
  assert.deepEqual(r.calls.texts, [["warn", "Too hasty here."]], "told in the procedure's own words, not through a lang key");
  assert.deepEqual(r.calls.notices, []);
  const seen = r.calls.asked.procedure.at("normal", { pace: "hasty" }, 3);
  assert.deepEqual([r.calls.asked.procedure.kind, seen.specs.map((s) => s.key), seen.band.template, seen.answer], [KIND, ["pace", "bonus"], "test/band.hbs", { pace: "hasty", bonus: 0 }]);
  assert.deepEqual(r.calls.asked.verdicts.normal.map((v) => v.key), [], "the first reading stands on the declared answer, none here");
  assert.deepEqual(r.calls.asked.verdictsAt("normal", {}, 3, null, undefined, { pace: "hasty" }).map((v) => [v.key, v.severity, v.notice]), [["tooHasty", "block", "Too hasty here."]], "and the dialog asks again with its own answer");
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {}, procedure: { pace: "hasty" } } });
  const warned = await cast(spell([heal()]), r.deps, () => r.calls.spends++);
  assert.equal(warned.ok, true);
  assert.deepEqual(r.calls.texts, [["warn", "Too hasty here."]]);
  assert.equal(log.performs.length, 1, "the Judge's cast performed");
  off();
});

await ta("perform runs once, after the cast has its id and before the first row is rolled, is given the answer coerced to the fields and a ctx the procedure reads, and what it returns rides the card", async () => {
  order.length = 0;
  const { procedure, log } = logging();
  const off = registerCastProcedure(KIND, procedure);
  const r = runDeps({ answer: { mode: "normal", picks: {}, procedure: { pace: "calm", bonus: "3" } } });
  const out = await cast(spell([heal()]), r.deps);
  assert.equal(out.ok, true);
  assert.deepEqual(order, ["castId", "perform", "roll"], "after the id, before the rows");
  assert.equal(log.performs.length, 1);
  const { ctx, answer } = log.performs[0];
  assert.deepEqual(answer, { pace: "calm", bonus: 3 });
  assert.deepEqual([ctx.castId, ctx.source, ctx.moment, ctx.isGM, ctx.tradition.kind, ctx.actor.name, ctx.spell.name, typeof ctx.roll, typeof ctx.now], ["castX", "spell", "free", false, KIND, "Tester", "Testrite", "function", "function"]);
  const card = r.calls.posts[0].card;
  assert.deepEqual(card.procedure, { kind: KIND, section: { title: "Rite", rows: [{ name: "Tester", total: 4 }] }, undo: { marks: 2 } });
  assert.deepEqual(card.order, ["mend"], "the rows ran after it");
  const view = castCardView(card, { isGM: false, canPress: false }, (k) => k);
  assert.equal(view.sections[0].title, "Rite", "the section stands above the rows' sections");
  assert.equal(view.sections.length, 2);
  off();
});

await ta("a spell with no rows is cast through its procedure alone: the card holds the section and nothing else", async () => {
  const { procedure } = logging();
  const off = registerCastProcedure(KIND, procedure);
  const r = runDeps({ answer: { mode: "normal", picks: {} } });
  const out = await cast(spell([]), r.deps);
  assert.equal(out.ok, true);
  const card = r.calls.posts[0].card;
  assert.deepEqual([card.order, card.procedure.section.title], [[], "Rite"]);
  off();
});

await ta("a cast with a procedure that has no perform, or none registered at all, posts exactly the card it always did", async () => {
  const off = registerCastProcedure(KIND, { fields: () => FIELDS });
  let r = runDeps({ answer: { mode: "normal", picks: {} } });
  await cast(spell([heal()]), r.deps);
  assert.equal(r.calls.posts[0].card.procedure, undefined, "no perform, no procedure on the card");
  off();
  r = runDeps({ answer: { mode: "normal", picks: {} } });
  await cast(spell([heal()]), r.deps);
  assert.equal(r.calls.posts[0].card.procedure, undefined);
  assert.equal(r.calls.asked.procedure, null);
  assert.equal(r.calls.asked.invocation.normal.offered, false);
});

await ta("a perform that does not proceed posts only its section: no rows, no records, no applications, and its rolls ride the message", async () => {
  order.length = 0;
  const dice = [{ total: 2 }];
  const { procedure } = logging({ perform: async () => ({ proceed: false, section: { title: "Rite", rows: [{ name: "Tester", total: 0 }] }, rolls: dice, undo: null }) });
  const off = registerCastProcedure(KIND, procedure);
  const r = runDeps({ answer: { mode: "normal", picks: {} } });
  const out = await cast(spell([heal()], { duration: { shape: "fixed", value: 1, unit: "minutes" } }), r.deps);
  assert.deepEqual([out.ok, out.performed], [true, false]);
  assert.equal(r.calls.posts.length, 1);
  const card = r.calls.posts[0].card;
  assert.deepEqual([card.order, card.rows, card.targets, card.lines, card.procedure.section.title], [[], {}, {}, [], "Rite"]);
  assert.deepEqual(r.calls.posts[0].options.rolls, dice);
  assert.deepEqual([r.calls.records, r.calls.applied, order.includes("roll")], [[], [], false]);
  off();
});

await ta("a perform that throws posts only a card with no section, saying the step did not complete", async () => {
  order.length = 0;
  const errors = [];
  const was = console.error;
  console.error = (...a) => errors.push(a);
  const { procedure } = logging({ perform: async () => { throw new Error("invented failure"); } });
  const off = registerCastProcedure(KIND, procedure);
  const r = runDeps({ answer: { mode: "normal", picks: {} } });
  let out;
  try {
    out = await cast(spell([heal()]), r.deps);
  } finally {
    console.error = was;
  }
  assert.deepEqual([out.ok, out.performed], [true, false]);
  assert.equal(r.calls.posts.length, 1);
  const card = r.calls.posts[0].card;
  assert.deepEqual([card.order, card.procedure.section, card.lines], [[], null, ["ACKS-MAGIC.cast.line.procedureFailed|{}"]]);
  assert.equal(order.includes("roll"), false);
  assert.equal(errors.length, 1, "the throw is logged once");
  console.error = () => {};
  const direct = await runPerform({ perform: async () => { throw new Error("x"); } }, {}, {}).catch(() => "escaped");
  console.error = was;
  assert.equal(direct.failed, true, "and never escapes the seam");
  off();
});

await ta("perform is not run at a declaration; the declaration stores the procedure's answer and its kind, and the turn resolves on them with no dialog and performs once", async () => {
  order.length = 0;
  const { procedure, log } = logging();
  const off = registerCastProcedure(KIND, procedure);
  const stored = [];
  const declare = runDeps({ answer: { mode: "normal", picks: {}, procedure: { pace: "calm", bonus: 2, buckets: { kit: [{ uuid: "Item.k1", qty: 2, fit: "a" }] } } }, declared: fight("cb2") });
  declare.deps.declare.declare = async (from) => (stored.push(from.answer), { castId: "d1" });
  const made = await cast(spell([heal()]), declare.deps);
  assert.equal(made.declared, true);
  assert.equal(log.performs.length, 0, "nothing is performed at the declaring");
  assert.deepEqual(declare.calls.posts, []);
  assert.equal(stored[0].procedureKind, KIND);
  const kept = answerStored(stored[0]);
  assert.deepEqual(kept.procedure, { pace: "calm", bonus: 2, buckets: { kit: [{ uuid: "Item.k1", qty: 2, fit: "a" }] } });
  assert.equal(kept.procedureKind, KIND);
  assert.ok("procedure" in ANSWER_FIELDS && "procedureKind" in ANSWER_FIELDS, "the stored shape names both");
  const pending = { spellUuid: "Actor.c1.Item.s1", ...kept, combatId: "k1", round: 1, at: 3, targets: [] };
  assert.deepEqual(answerFromPending(pending).procedure, kept.procedure);
  assert.deepEqual(answerFromPending({ ...pending, procedure: null }).procedure, {}, "a record with none reads an empty answer");
  const resolve = runDeps({ answer: null, declared: { ...fight("cb1"), declarations: [{ castId: "d1", role: "caster", pending }] } });
  resolve.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
  const out = await cast(spell([heal()]), resolve.deps);
  assert.equal(out.ok, true);
  assert.equal(resolve.calls.asked, null, "a stored answer that fits asks nothing");
  assert.equal(log.performs.length, 1);
  assert.deepEqual(log.performs[0].answer, { pace: "calm", bonus: 2, buckets: { kit: [{ uuid: "Item.k1", qty: 2, fit: "a" }] } }, "performed on the stored answer");
  assert.equal(log.performs[0].ctx.moment, "resolve");
  assert.equal(resolve.calls.posts[0].card.procedure.kind, KIND);
  off();
});

await ta("the Judge's revert: the card carries the undo data, only a Judge sees the button and may press it, the procedure gets the data, and a second press does nothing", async () => {
  const { procedure, log } = logging();
  const off = registerCastProcedure(KIND, procedure);
  const r = runDeps({ answer: { mode: "normal", picks: {} } });
  await cast(spell([heal()]), r.deps);
  const card = r.calls.posts[0].card;
  const buttons = (seat, c = card) => castCardView(c, seat, (k) => k).buttons.map((b) => b.action);
  assert.equal(buttons({ isGM: false, canPress: true, ownsCaster: true }).includes(CARD_ACTIONS.revert), false, "not on a Player's seat, the caster's owner included");
  assert.ok(buttons({ isGM: true, canPress: true }).includes(CARD_ACTIONS.revert), "on the Judge's");
  assert.deepEqual(buttons({ isGM: true, canPress: true }, { ...card, procedure: { ...card.procedure, reverted: true } }).includes(CARD_ACTIONS.revert), false, "gone once reverted");
  assert.equal(buttons({ isGM: true, canPress: true }, { ...card, procedure: { ...card.procedure, undo: null } }).includes(CARD_ACTIONS.revert), false, "gone with nothing to put back");
  assert.match(CARD_ACTIONS.revert, /^magicCast/, "named so the card's render hook binds it");
  assert.deepEqual(await runRevert(card, { isGM: false }), { ok: false, reason: "notGM" });
  assert.equal(log.reverts.length, 0, "a Player's press reverts nothing");
  assert.deepEqual(await runRevert(card, { isGM: true, actor: "a" }), { ok: true });
  assert.deepEqual([log.reverts.length, log.reverts[0].undo, log.reverts[0].ctx.actor, log.reverts[0].ctx.source], [1, { marks: 2 }, "a", "spell"]);
  assert.deepEqual(await runRevert({ ...card, procedure: { ...card.procedure, reverted: true } }, { isGM: true }), { ok: false, reason: "nothing" });
  assert.deepEqual(await runRevert({ ...card, procedure: { kind: "elsewhere", undo: 1 } }, { isGM: true }), { ok: false, reason: "noRevert" });
  const was = console.error;
  console.error = () => {};
  try {
    const bad = registerCastProcedure("badkind", { revert: async () => { throw new Error("x"); } });
    assert.deepEqual(await runRevert({ procedure: { kind: "badkind", undo: 1 } }, { isGM: true }), { ok: false, reason: "threw" });
    bad();
  } finally {
    console.error = was;
  }
  off();
});

await ta("a lost declaration runs the procedure's `lost` once for the cast, however often it is told, and only for a record that names a kind with one", async () => {
  const { procedure, log } = logging();
  const off = registerCastProcedure(KIND, procedure);
  const record = { castId: "lostA", pending: { procedureKind: KIND, spellUuid: "S" } };
  assert.equal(await runLost(record, { actor: "a" }), true);
  assert.equal(await runLost(record, { actor: "a" }), false, "told twice, run once");
  assert.equal(log.losts.length, 1);
  assert.deepEqual([log.losts[0].declaration, log.losts[0].ctx.actor, log.losts[0].ctx.source], [record, "a", "spell"]);
  assert.equal(await runLost({ castId: "lostB", pending: { procedureKind: null } }, {}), false, "no kind recorded");
  assert.equal(await runLost({ castId: "lostC", pending: { procedureKind: "elsewhere" } }, {}), false, "no procedure for the kind");
  assert.equal(await runLost({ pending: { procedureKind: KIND } }, {}), false, "no cast id");
  off();
  assert.equal(await runLost({ castId: "lostD", pending: { procedureKind: KIND } }, {}), false, "removed");
});

await ta("a procedure that has no member, or whose members throw, never stops the cast or the dialog", async () => {
  const was = console.error;
  const errors = [];
  console.error = (...a) => errors.push(a);
  try {
    const off = registerCastProcedure(KIND, {
      fields: () => { throw new Error("f"); },
      verdicts: () => { throw new Error("v"); },
      castingTime: () => { throw new Error("c"); },
      band: () => { throw new Error("b"); },
    });
    const r = runDeps({ answer: { mode: "normal", picks: {} } });
    const out = await cast(spell([heal()]), r.deps);
    assert.equal(out.ok, true);
    assert.ok(errors.length >= 3, "each throw is logged");
    off();
  } finally {
    console.error = was;
  }
});

/* ------------------------------------------------------------------ */
/*  Long casts                                                        */
/* ------------------------------------------------------------------ */

const SLOW = { castingTime: { shape: "timed", value: 1, unit: "turns" } };

await ta("a long cast in a begun fight is never declared: a Player is blocked before the spend, and a Judge is warned and resolves at the confirm with the card naming the time", async () => {
  order.length = 0;
  let r = runDeps({ answer: { mode: "normal", picks: {} }, declared: fight("cb2") });
  const refused = await cast(spell([heal()], SLOW), r.deps, () => r.calls.spends++);
  assert.deepEqual([refused.ok, refused.reason, r.calls.spends, r.calls.declares.length], [false, "longCast", 0, 0]);
  assert.equal(r.calls.asked.moment, "long");
  assert.deepEqual(r.calls.asked.verdicts.normal.map((v) => v.key), ["longCast"], "the dialog is told at its first reading");
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {} }, declared: fight("cb2") });
  const done = await cast(spell([heal()], SLOW), r.deps, () => r.calls.spends++);
  assert.deepEqual([done.ok, done.declared, r.calls.spends, r.calls.declares.length], [true, undefined, 1, 0], "cast at the confirm, not declared");
  assert.ok(r.calls.notices.some(([lvl, key]) => lvl === "warn" && key === "verdict.longCast"));
  const card = r.calls.posts[0].card;
  assert.deepEqual(card.castingTime, { value: 1, unit: "turns", source: "spell" });
  const view = castCardView(card, { isGM: false, canPress: false }, (k, d) => `${k}|${JSON.stringify(d ?? {})}`);
  assert.ok(view.note.includes('note.castingTime|{"value":1,"unit":"turns"}'));
  assert.ok(view.noteTooltip.includes("tip.castingTime.spell"));
  r = runDeps({ answer: { mode: "normal", picks: {} } });
  await cast(spell([heal()], SLOW), r.deps);
  assert.equal(r.calls.posts[0].card.castingTime, undefined, "outside a fight the time is the spell's own business");
});

await ta("a short spell in a fight is declared as before, and a spell over a round with no begun fight casts free", async () => {
  let r = runDeps({ answer: { mode: "normal", picks: {} }, declared: fight("cb2") });
  const out = await cast(spell([heal()], { castingTime: { shape: "round" } }), r.deps);
  assert.deepEqual([out.ok, out.declared, r.calls.declares.length], [true, true, 1]);
  r = runDeps({ answer: { mode: "normal", picks: {} } });
  assert.equal((await cast(spell([heal()], SLOW), r.deps)).ok, true);
});

await ta("the procedure's casting time stands over the spell's, is read from the final answer, and is given the invocation level", async () => {
  const { procedure, log } = logging();
  const off = registerCastProcedure(KIND, procedure);
  // The spell is quick; the seat's pace answer makes the cast long. The dialog opened on a declaration moment and the answer settles it.
  let r = runDeps({ answer: { mode: "normal", picks: {}, procedure: { pace: "slow" } }, declared: fight("cb2"), cap: 3 });
  const spellInv = spell([heal()], { castingTime: { shape: "round" } });
  const out = await cast(spellInv, r.deps);
  assert.deepEqual([out.ok, out.reason], [false, "longCast"], "recalculated from the answer, which the dialog's first reading did not hold");
  assert.equal(r.calls.asked.moment, "declare");
  assert.equal(r.calls.asked.momentAt("normal", 3, { pace: "slow" }), "long", "and the dialog can ask it of its own answer");
  assert.equal(r.calls.asked.momentAt("normal", 3, { pace: "calm" }), "declare");
  assert.equal(r.calls.declares.length, 0);
  // A Judge's cast names the procedure's time on the card.
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {}, procedure: { pace: "slow" } }, declared: fight("cb2"), cap: 3 });
  await cast(spellInv, r.deps);
  assert.deepEqual(r.calls.posts[0].card.castingTime, { value: 3, unit: "turns", source: "procedure" });
  // The invocation level reaches castingTime (ruling 207).
  log.times.length = 0;
  r = runDeps({ answer: { mode: "normal", picks: {}, invocationLevel: 2, procedure: { pace: "calm" } }, cap: 3 });
  await cast(spellInv, r.deps);
  assert.ok(log.times.length > 0);
  assert.ok(log.times.every(({ ctx }) => ctx.invocationLevel === null || ctx.invocationLevel === 2));
  assert.equal(log.times.at(-1).ctx.invocationLevel, 2, "the last read is the final answer's level");
  off();
});

/* ------------------------------------------------------------------ */
/*  Buckets                                                           */
/* ------------------------------------------------------------------ */

await ta("at the turn each stored bucket entry is read again: one the world lacks reopens the dialog on what was declared, and keeping it is bucketChanged (a Player blocked, a Judge warned); with none gone nothing is asked", async () => {
  const { procedure, log } = logging();
  const off = registerCastProcedure(KIND, procedure);
  const procAnswer = { pace: "calm", bonus: 0, buckets: { kit: [{ uuid: "Item.k1", qty: 1, fit: "" }, { uuid: "Item.k2", qty: 1, fit: "" }] } };
  const pending = { spellUuid: "Actor.c1.Item.s1", ...answerStored({ mode: "normal", procedure: procAnswer, targets: [] }), combatId: "k1", round: 1, at: 3 };
  const declared = { ...fight("cb1"), declarations: [{ castId: "d1", role: "caster", pending }] };
  const asked = [];
  const holds = async (uuid) => (asked.push(uuid), uuid !== "Item.k2");
  let r = runDeps({ answer: { mode: "normal", picks: {}, procedure: procAnswer }, declared, holds });
  r.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
  const refused = await cast(spell([heal()]), r.deps);
  assert.deepEqual(asked.slice(0, 2), ["Item.k1", "Item.k2"], "each stored uuid is read again");
  assert.deepEqual([refused.ok, refused.reason], [false, "bucketChanged"]);
  assert.deepEqual(r.calls.asked.initial.procedure.buckets.kit.map((e) => e.uuid), ["Item.k1", "Item.k2"], "the dialog reopened prefilled with what was declared");
  assert.ok(r.calls.notices.some(([lvl, key]) => lvl === "warn" && key === "resolveBucket"));
  assert.deepEqual(r.calls.asked.verdicts.normal.map((v) => v.key), ["bucketChanged"]);
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {}, procedure: procAnswer }, declared, holds });
  r.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
  assert.equal((await cast(spell([heal()]), r.deps)).ok, true, "a Judge is warned and casts");
  assert.ok(r.calls.notices.some(([lvl, key]) => lvl === "warn" && key === "verdict.bucketChanged"));
  // A seat that drops the missing entry casts, and nothing gone means nothing is asked.
  const fixed = { ...procAnswer, buckets: { kit: [procAnswer.buckets.kit[0]] } };
  r = runDeps({ answer: { mode: "normal", picks: {}, procedure: fixed }, declared, holds });
  r.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
  assert.equal((await cast(spell([heal()]), r.deps)).ok, true);
  const present = runDeps({ answer: null, declared, holds: async () => true });
  present.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
  assert.equal((await cast(spell([heal()]), present.deps)).ok, true);
  assert.equal(present.calls.asked, null, "every entry still there: the stored answer resolves with no dialog");
  assert.equal(log.performs.at(-1).answer.buckets.kit.length, 2);
  off();
});

await ta("a cast with no `holds` dep takes every stored bucket entry as present", async () => {
  const { procedure } = logging();
  const off = registerCastProcedure(KIND, procedure);
  const pending = { spellUuid: "Actor.c1.Item.s1", ...answerStored({ mode: "normal", procedure: { pace: "calm", buckets: { kit: [{ uuid: "Item.k1" }] } }, targets: [] }), combatId: "k1", round: 1, at: 3 };
  const r = runDeps({ answer: null, declared: { ...fight("cb1"), declarations: [{ castId: "d1", role: "caster", pending }] } });
  r.deps.declaredTargets = async () => ({ tokens: [], gaps: {}, gone: [] });
  assert.equal((await cast(spell([heal()]), r.deps)).ok, true);
  assert.equal(r.calls.asked, null);
  off();
});

/* ------------------------------------------------------------------ */
/*  Rituals                                                           */
/* ------------------------------------------------------------------ */

await ta("a ritual spell is refused a Player and warns a Judge until the ritual project lands; a spell that is no ritual is untouched", async () => {
  let r = runDeps({ answer: { mode: "normal", picks: {} } });
  const refused = await cast(spell([heal()], { ritual: true }), r.deps, () => r.calls.spends++);
  assert.deepEqual([refused.ok, refused.reason, r.calls.spends], [false, "ritualPending", 0]);
  r = runDeps({ isGM: true, answer: { mode: "normal", picks: {} } });
  assert.equal((await cast(spell([heal()], { ritual: true }), r.deps)).ok, true);
  assert.ok(r.calls.notices.some(([lvl, key]) => lvl === "warn" && key === "verdict.ritualPending"));
  r = runDeps({ answer: { mode: "normal", picks: {} } });
  assert.equal((await cast(spell([heal()], { ritual: false }), r.deps)).ok, true);
});

console.log(`\n${n} cast procedure tests passed`);
