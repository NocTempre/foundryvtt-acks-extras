/**
 * A summoning spell's cast through the spell cast (`cast-spell.mjs`), offline:
 * the order of the cast (dialog and verdicts, the seat's clicks, the spend, the
 * end of a concentration, the id, the tradition's step, the placement, the
 * card), a cancel at the clicks, the count's ceiling at the caster level and at
 * an invocation level, the verdicts that block a Player and warn a Judge, the
 * range and calling handed to lib, a refusal after the spend, a declared
 * summons, the end a record announces, and the policy that reads the same
 * ceiling. The cast dialog's Summon band supplies the answer's `summon` (its
 * model is walked at the end: the offer, the ceiling and its tooltip, the
 * placement line, the footer's verdicts per seat, the answer); an answer with
 * none falls to the existing shelf prompt. Foundry-free; every spell, creature
 * and figure below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-summon.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const Handlebars = (await import("handlebars")).default;
const HELD_CARD = Handlebars.compile(fs.readFileSync(new URL("../templates/magic/cast-held-card.hbs", import.meta.url), "utf8"));
globalThis.foundry = { utils: { escapeHTML: (s) => String(s) }, applications: { handlebars: { renderTemplate: async (_path, view) => HELD_CARD(view) } } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key } };
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
globalThis.ui = { notifications: { warn() {}, info() {} } };

const { castSpellRun, castSpellClaims, castSpellClaimant } = await import("../scripts/magic/cast-spell.mjs");
const { summonCeiling, summonCeilingFor, summonIsCalling, summonRefusal, summonRowsOf, summonFitting } = await import("../scripts/magic/cast-summon.mjs");
const { castVerdicts, VERDICT } = await import("../scripts/magic/cast-plan.mjs");
const { ANSWER_FIELDS, answerStored, answerFromPending } = await import("../scripts/magic/cast-declare.mjs");
const { registerCastProcedure } = await import("../scripts/magic/cast-procedure.mjs");
const { heldRecordData, endHeldCast, heldEndContent, pressDismiss } = await import("../scripts/magic/cast-held.mjs");
const { castDuration } = await import("../scripts/magic/cast-duration.mjs");
const { registerInventedTime } = await import("./time-unit-fixture.mjs");
// A duration counted in turns is priced in the imported turn's seconds.
registerInventedTime();
const { stepOf } = await import("../scripts/magic/cast-kinds.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { sweepEndedCasts } = await import("../scripts/magic/cast-expiry.mjs");
const { addSpellUseClaimant, installSpellUsePatch, removeSpellUseClaimant } = await import("../scripts/lib/patches/spell-use.mjs");

let n = 0;
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };
const GM_SEAT = { id: "gm", isGM: true };
const PLAYER_SEAT = { id: "p1", isGM: false };
const REF = "def.invented.glimmerkin";
const GLIMMER = { uuid: "Compendium.invented.Actor.abc", name: "Glimmerkin", type: "monster", flags: { "acks-extras": { cookbook: { id: REF } } } };
const CASTER_TOKEN = { id: "tok1", uuid: "Scene.s1.Token.tok1" };
const KIND = "testkind";
const tradition = { key: "wisp", label: "Wisp", kind: KIND, slots: [], spellList: [] };
const classItem = { system: { casting: [tradition], ladders: [] } };

const row = (over = {}) => ({ key: "call", type: "summon", ref: REF, amount: 2, ...over });
const perLevel = (base, per) => ({ kind: "perLevel", base, per });
const rungs = (...pairs) => ({ kind: "conditional", on: "invocationLevel", breakpoints: pairs.map(([atLevel, value]) => ({ atLevel, value })) });

/** A summoning spell on a character the seat owns. */
const makeSpell = ({ rows = [row()], extra = {}, over = {} } = {}) => {
  const caster = { id: "c1", type: "character", isOwner: true, uuid: "Actor.c1", name: "Invented Caster", effects: [] };
  return {
    id: "sp1",
    type: "spell",
    uuid: "Actor.c1.Item.sp1",
    name: "Invented Calling",
    img: "icons/invented.webp",
    system: { lvl: 1, class: "" },
    parent: caster,
    flags: { "acks-extras": { spell: { schools: ["summoning"], effects: rows, ...extra } } },
    ...over,
  };
};

/**
 * The dependencies of one run, with the order the seams were reached in. The
 * clicks, the verdict, the placement and the shelf prompt are doubles: lib's own
 * are walked in `test-summons.mjs` and live.
 */
function runDeps({ answer, isGM = false, gmOnline = true, level = { matched: false }, capacity = { verdict: "ok" }, tradition: trad = null, world = {}, clicks, verdict, place, pickSummon } = {}) {
  const calls = { notices: [], texts: [], posts: [], records: [], spends: 0, pools: [], verdicts: [], clicked: [], placed: [], picked: [], declares: [], finishes: 0, ended: 0, asked: 0 };
  const order = [];
  const deps = {
    lookups: NO_TWIN,
    read: async () => ({ actor: {}, tokens: [], casterToken: CASTER_TOKEN, gaps: {}, statuses: [], capacity, level, cap: null, tradition: trad, classItem: trad ? classItem : null, ...world }),
    ask: async () => (order.push("ask"), calls.asked++, answer),
    notify: (lvl, key, data) => calls.notices.push([lvl, key, data]),
    notifyText: (lvl, text) => calls.texts.push([lvl, text]),
    adjustPool: async (...args) => (order.push("pool"), calls.pools.push(args.slice(1))),
    castId: () => (order.push("castId"), "castX"),
    roll: () => 1,
    post: async (card) => (order.push("post"), calls.posts.push(card), { id: "m1", flags: { "acks-extras": { castCard: card } } }),
    apply: async () => {},
    record: async (caster, data) => (order.push("record"), calls.records.push(data)),
    throwRow: async () => null,
    now: () => 10,
    isGM: () => isGM,
    gmOnline: () => gmOnline,
    endHeld: async () => void (order.push("endHeld"), calls.ended++),
    declare: {
      declare: async (from) => (order.push("declare"), calls.declares.push(from), { castId: "d1" }),
      finish: async () => void (order.push("finish"), calls.finishes++),
      clearHand: async () => {},
    },
    declaredTargets: async () => ({ tokens: [], gaps: {}, gone: [] }),
    resolveRef: async (ref) => (ref === REF || ref === GLIMMER.uuid ? GLIMMER : null),
    pickSummon: async (caster, o) => (order.push("pickSummon"), calls.picked.push(o), pickSummon === undefined ? { sourceUuid: REF, count: 2, spellId: "sp1" } : pickSummon),
    summonVerdict: async (caster, o) => (order.push("verdict"), calls.verdicts.push(o), verdict ?? { ok: true }),
    pickPlacement: async (caster, o) => {
      order.push("clicks");
      calls.clicked.push(o);
      const made = typeof clicks === "function" ? clicks(o) : clicks === undefined ? { positions: [{ x: 10, y: 10 }, { x: 20, y: 20 }] } : clicks;
      return made;
    },
    summon: async (ctx) => {
      order.push("place");
      calls.placed.push(ctx);
      return typeof place === "function" ? place(ctx) : (place ?? { ok: true, castId: ctx.castId, tokenUuids: ctx.positions.map((_, i) => `Scene.s1.Token.t${i}`) });
    },
  };
  const spend = async () => void (order.push("spend"), calls.spends++);
  return { deps, calls, order, spend };
}

const answerOf = (over = {}) => ({ mode: "normal", picks: {}, summon: { ref: REF, count: 2 }, ...over });
const cast = (spell, r) => castSpellRun(spell, r.spend, r.deps);
const keys = (r) => r.calls.notices.map(([lvl, key]) => `${lvl}:${key}`);

const fight = (combatantId) => ({
  combat: { id: "k1", started: true, round: 1, turn: 1, turns: [{ id: "cb2" }, { id: "cb1" }], flags: {}, combatant: { id: combatantId } },
  combatant: { id: "cb1", initiative: 9 },
});

/* ------------------------------------------------------------------ */
/*  The claim and the order                                           */
/* ------------------------------------------------------------------ */

await ta("a character's summoning spell is claimed with its rows or without them; the old claimant is gone", () => {
  assert.equal(castSpellClaims(makeSpell(), NO_TWIN), true);
  assert.equal(castSpellClaims(makeSpell({ rows: [] }), NO_TWIN), true, "a rowless one is the shelf pick's");
  assert.equal(castSpellClaims(makeSpell({ over: { parent: { type: "character", isOwner: false } } }), NO_TWIN), false, "a character this seat does not own");
  assert.equal(castSpellClaimant({ lookups: NO_TWIN }).claims(makeSpell()), true);
});

await ta("the order: dialog and verdicts, the clicks, the spend and the pool, the end of a concentration, the id, the tradition's step, the placement, the record, the card", async () => {
  const off = registerCastProcedure(KIND, { perform: async () => (r.order.push("perform"), { proceed: true, section: { title: "Rite", rows: [] }, rolls: [], undo: null }) });
  const r = runDeps({ answer: answerOf(), tradition, capacity: { verdict: "ok", source: "tradition", tradition: "wisp", slotKey: "s1" }, level: { matched: true, classLevel: 5 } });
  const spell = makeSpell({ extra: { duration: { shape: "fixed", value: 2, unit: "hours" }, lists: [{ source: "wisp", level: 1 }] } });
  const out = await cast(spell, r);
  off();
  assert.equal(out.ok, true);
  assert.deepEqual(r.order, ["ask", "verdict", "clicks", "spend", "pool", "endHeld", "castId", "perform", "place", "record", "post"]);
  const ctx = r.calls.placed[0];
  assert.deepEqual(ctx.positions, [{ x: 10, y: 10 }, { x: 20, y: 20 }], "the clicks' places are what is placed");
  assert.deepEqual([ctx.castId, ctx.cast, ctx.pick, ctx.casterToken], ["castX", { castId: "castX", casterLevel: 5, invocationLevel: null }, { ref: REF, count: 2 }, CASTER_TOKEN]);
  assert.equal(ctx.caster, spell.parent);
  assert.equal(ctx.spell, spell);
  assert.deepEqual(r.calls.verdicts, [{ sourceUuid: REF, count: 2, spellId: "sp1" }], "lib's checks answer before anything is spent");
  assert.deepEqual(r.calls.clicked[0], { sourceUuid: REF, count: 2, spellId: "sp1", rangeFeet: null, calling: false, casterToken: CASTER_TOKEN });
  assert.equal(spellEffectOf(r.calls.records[0]).castId, "castX", "the record carries the id the creatures carry");
  assert.ok(r.calls.posts[0].lines.includes("ACKS-MAGIC.cast.line.summoned|{\"name\":\"Glimmerkin\",\"n\":2,\"duration\":\"2 hours\"}"), "the card names the creature, how many stood and how long");
  assert.equal(out.placed.ok, true);
});

await ta("summon.step: the kind's step takes the placement request and the cast's deps, and calls deps.summon with the request", async () => {
  const seen = [];
  const request = { caster: {}, spell: {}, castId: "id", pick: { ref: REF, count: 1 }, positions: [{ x: 1, y: 1 }], cast: { castId: "id", casterLevel: 1, invocationLevel: null }, rangeFeet: null, calling: false, casterToken: null };
  const done = await stepOf("summon")(request, { summon: async (ctx) => (seen.push(ctx), { ok: true }) });
  assert.deepEqual([done, seen[0] === request], [{ ok: true }, true]);
  assert.equal(stepOf("damage"), null);
});

await ta("a cancel at the clicks spends nothing, ends nothing, mints no id, places nothing and writes nothing", async () => {
  for (const clicks of [null, { positions: [] }]) {
    const r = runDeps({ answer: answerOf(), clicks, capacity: { verdict: "ok", source: "tradition", tradition: "wisp", slotKey: "s1" } });
    const out = await cast(makeSpell(), r);
    assert.deepEqual([out.ok, out.reason], [false, "cancelled"]);
    assert.deepEqual(r.order, ["ask", "verdict", "clicks"], JSON.stringify(clicks));
    assert.deepEqual([r.calls.spends, r.calls.pools.length, r.calls.records.length, r.calls.posts.length, r.calls.placed.length], [0, 0, 0, 0, 0]);
  }
});

await ta("a cancelled dialog spends nothing; the shelf prompt answers a cast whose answer names no creature, and a cancel there spends nothing", async () => {
  let r = runDeps({ answer: null });
  assert.equal((await cast(makeSpell(), r)).reason, "cancelled");
  assert.deepEqual(r.order, ["ask"]);
  r = runDeps({ answer: { mode: "normal", picks: {} } });
  const spell = makeSpell({ rows: [row(), row({ ref: "def.invented.other" })] });
  const out = await cast(spell, r);
  assert.equal(out.ok, true);
  assert.deepEqual(r.order.slice(0, 4), ["ask", "pickSummon", "verdict", "clicks"]);
  assert.deepEqual(r.calls.picked[0].options.map((o) => o.ref), [REF, "def.invented.other"], "the prompt is handed the spell's rows");
  assert.equal(r.calls.picked[0].resolveRef, r.deps.resolveRef);
  assert.deepEqual(r.calls.placed[0].pick, { ref: REF, count: 2 });
  r = runDeps({ answer: { mode: "normal", picks: {} }, pickSummon: null });
  assert.deepEqual([(await cast(makeSpell(), r)).reason, r.calls.spends], ["cancelled", 0]);
  r = runDeps({ answer: { mode: "normal", picks: {} }, pickSummon: { sourceUuid: "Compendium.invented.Actor.zzz", count: 1, spellId: "sp1" } });
  const rowless = await cast(makeSpell({ rows: [] }), r);
  assert.equal(rowless.ok, true, "a rowless summoning spell is cast on the shelf pick");
  assert.deepEqual(r.calls.picked[0].options, []);
  assert.equal(r.calls.placed[0].pick.ref, "Compendium.invented.Actor.zzz");
  assert.equal(r.calls.records.length, 1, "and leaves its record");
});

/* ------------------------------------------------------------------ */
/*  The count                                                         */
/* ------------------------------------------------------------------ */

await ta("the ceiling is max at the caster level, else amount, and a blank stays blank; each caster level reads its own", async () => {
  const spell = () => makeSpell({ rows: [row({ amount: 2, max: perLevel(2, 2) })] });
  const asks = async (level, count, isGM = false) => {
    const r = runDeps({ answer: answerOf({ casterLevel: level, summon: { ref: REF, count } }), isGM });
    const out = await cast(spell(), r);
    return { out, r };
  };
  let { out, r } = await asks(3, 7);
  assert.deepEqual([out.ok, out.reason, r.calls.spends], [false, "summonCount", 0], "level 3 allows 6: a Player asking 7 is blocked before the spend");
  assert.deepEqual(r.calls.notices[0], ["warn", "blocked.summonCount", { name: "Invented Caster", names: "", max: 6, over: 1 }]);
  assert.deepEqual(r.order, ["ask", "verdict"], "and before the clicks");
  ({ out, r } = await asks(5, 7));
  assert.equal(out.ok, true, "level 5 allows 10");
  assert.equal(r.calls.placed[0].cast.casterLevel, 5);
  ({ out, r } = await asks(5, 11));
  assert.deepEqual([out.ok, r.calls.notices[0][2].max, r.calls.notices[0][2].over], [false, 10, 1]);
  const blank = runDeps({ answer: answerOf({ summon: { ref: REF, count: 99 } }) });
  assert.equal((await cast(spell(), blank)).ok, true, "no caster level: a max that cannot be read states no ceiling, and the amount is not put in its place");
  const amountOnly = runDeps({ answer: answerOf({ summon: { ref: REF, count: 3 } }) });
  assert.equal((await cast(makeSpell({ rows: [row({ amount: 2 })] }), amountOnly)).reason, "summonCount", "with no max the amount is the ceiling");
  const maxBeatsAmount = runDeps({ answer: answerOf({ summon: { ref: REF, count: 4 } }) });
  assert.equal((await cast(makeSpell({ rows: [row({ amount: 2, max: { kind: "flat", flat: 5 } })] }), maxBeatsAmount)).ok, true, "max replaces amount as the ceiling");
  const none = runDeps({ answer: answerOf({ summon: { ref: REF, count: 40 } }) });
  assert.equal((await cast(makeSpell({ rows: [row({ amount: 0, max: null })] }), none)).ok, true, "a row stating neither sets no limit");
  const open = runDeps({ answer: { mode: "normal", picks: {}, summon: { ref: "Compendium.invented.Actor.zzz", count: 40 } } });
  assert.equal((await cast(makeSpell({ rows: [] }), open)).ok, true, "a rowless spell states no ceiling");
});

await ta("the ceiling reads an invented invocation ladder first: a max keyed on the invocation level resolves before the caster level reads it", async () => {
  const spell = () => makeSpell({ rows: [row({ amount: 1, max: rungs([1, 2], [3, 5]) })] });
  const asks = async (invocationLevel, count) => {
    const r = runDeps({ answer: answerOf({ invocationLevel, summon: { ref: REF, count } }), isGM: true, level: { matched: true, classLevel: 4 } });
    const out = await cast(spell(), r);
    return { out, r };
  };
  let { out, r } = await asks(1, 3);
  assert.deepEqual(r.calls.notices.find(([, key]) => key === "verdict.summonCount")?.[2].max, 2, "invocation level 1 reads the first rung");
  assert.equal(out.ok, true, "a Judge is warned and the cast goes on");
  ({ out, r } = await asks(3, 5));
  assert.equal(r.calls.notices.some(([, key]) => key === "verdict.summonCount"), false, "invocation level 3 reads the second rung, which allows 5");
  assert.equal(r.calls.placed[0].cast.invocationLevel, 3);
  ({ out, r } = await asks(3, 6));
  assert.equal(r.calls.notices.find(([, key]) => key === "verdict.summonCount")[2].max, 5);
});

await ta("summonCount blocks a Player before anything is spent and only warns a Judge, whose cast goes on to place the count asked", async () => {
  const spell = () => makeSpell({ rows: [row({ amount: 2 })] });
  const player = runDeps({ answer: answerOf({ summon: { ref: REF, count: 3 } }) });
  const blocked = await cast(spell(), player);
  assert.deepEqual([blocked.ok, blocked.reason, player.calls.spends, player.calls.placed.length], [false, "summonCount", 0, 0]);
  assert.deepEqual(keys(player), ["warn:blocked.summonCount"]);
  const judge = runDeps({ answer: answerOf({ summon: { ref: REF, count: 3 } }), isGM: true });
  const warned = await cast(spell(), judge);
  assert.deepEqual([warned.ok, judge.calls.spends], [true, 1]);
  assert.deepEqual(keys(judge), ["warn:verdict.summonCount"]);
  assert.equal(judge.calls.clicked[0].count, 3);
  assert.deepEqual(castVerdicts({ summon: { count: 3, ceiling: 2 } }).map((v) => [v.key, v.severity, v.max, v.over]), [[VERDICT.summonCount, "block", 2, 1]]);
  assert.deepEqual(castVerdicts({ isGM: true, summon: { count: 3, ceiling: 2 } }).map((v) => [v.key, v.severity]), [[VERDICT.summonCount, "warn"]]);
  assert.deepEqual(castVerdicts({ summon: { count: 2, ceiling: 2 } }), []);
  assert.deepEqual(castVerdicts({ summon: { count: 9, ceiling: null } }), []);
  assert.deepEqual(castVerdicts({ summon: { count: null, ceiling: 2 } }), []);
});

/* ------------------------------------------------------------------ */
/*  Refusals before the spend, range, calling                         */
/* ------------------------------------------------------------------ */

await ta("a refusal lib gives before a click is a verdict before the spend, in lib's own words, and stops a Judge as it stops a Player", async () => {
  for (const isGM of [false, true]) {
    const r = runDeps({ answer: answerOf(), isGM, verdict: { ok: false, reason: "notNamed", notice: "That creature is not one this spell calls." } });
    const out = await cast(makeSpell(), r);
    assert.deepEqual([out.ok, out.reason, r.calls.spends], [false, "summonRefused", 0], `isGM ${isGM}`);
    assert.deepEqual(r.calls.texts, [["warn", "That creature is not one this spell calls."]]);
    assert.deepEqual(r.order, ["ask", "verdict"], "no click is asked for");
  }
  assert.deepEqual(castVerdicts({ isGM: true, summon: { refused: { reason: "noCanvas", notice: "words" } } }).map((v) => [v.key, v.severity, v.reason, v.notice]), [[VERDICT.summonRefused, "block", "noCanvas", "words"]]);
});

await ta("the range handed to the clicks and to the placement is the spell's figure in feet at the caster level, a number; none where the spell states none", async () => {
  const feet = (extra, level) => {
    const r = runDeps({ answer: answerOf(level ? { casterLevel: level } : {}) });
    return cast(makeSpell({ extra }), r).then(() => r);
  };
  let r = await feet({ range: { shape: "distance", value: 30, unit: "feet" } });
  assert.deepEqual([r.calls.clicked[0].rangeFeet, r.calls.placed[0].rangeFeet], [30, 30]);
  assert.equal(typeof r.calls.clicked[0].rangeFeet, "number", "lib reads anything but a number as no range");
  r = await feet({ range: { shape: "distancePerLevel", value: 10, unit: "feet" } }, 3);
  assert.deepEqual([r.calls.clicked[0].rangeFeet, r.calls.placed[0].rangeFeet], [30, 30]);
  r = await feet({});
  assert.deepEqual([r.calls.clicked[0].rangeFeet, r.calls.placed[0].rangeFeet], [null, null]);
});

await ta("out of range before the spend: a Player's click beyond it is refused and nothing is spent; a Judge's is warned by lib and the cast goes on", async () => {
  const lib = (isGM) => (o) => {
    const beyond = [{ x: 500, y: 0 }].some((p) => p.x > o.rangeFeet);
    return beyond && !isGM ? null : { positions: [{ x: 500, y: 0 }] };
  };
  const spell = () => makeSpell({ rows: [row({ amount: 1 })], extra: { range: { shape: "distance", value: 30, unit: "feet" } } });
  const player = runDeps({ answer: answerOf({ summon: { ref: REF, count: 1 } }), clicks: lib(false) });
  assert.deepEqual([(await cast(spell(), player)).reason, player.calls.spends, player.calls.clicked[0].rangeFeet], ["cancelled", 0, 30]);
  const judge = runDeps({ answer: answerOf({ summon: { ref: REF, count: 1 } }), isGM: true, clicks: lib(true) });
  assert.deepEqual([(await cast(spell(), judge)).ok, judge.calls.spends, judge.calls.placed[0].positions], [true, 1, [{ x: 500, y: 0 }]]);
});

await ta("out of range after the spend: the GM's refusal is a line on the card, the spend stands, the record is written, and a missing GM has its own line", async () => {
  let r = runDeps({ answer: answerOf(), place: { ok: false, reason: "outOfRange", notice: "beyond the range" } });
  let out = await cast(makeSpell(), r);
  assert.equal(out.ok, true, "the cast happened");
  assert.equal(r.calls.spends, 1, "and its spend stands");
  assert.ok(r.calls.posts[0].lines.includes('ACKS-MAGIC.cast.line.summonRefused|{"reason":"beyond the range"}'));
  assert.equal(r.calls.records.length, 1);
  r = runDeps({ answer: answerOf(), place: { ok: false, reason: "noGm" } });
  out = await cast(makeSpell(), r);
  assert.ok(r.calls.posts[0].lines.includes("ACKS-MAGIC.cast.line.summonNoGm|{}"));
  assert.equal(r.calls.spends, 1);
});

await ta("no GM connected is a verdict before the spend for a Player, so the slot is never lost to it; a Judge's own seat needs no relay, and a declaring places nothing", async () => {
  const player = runDeps({ answer: answerOf(), gmOnline: false });
  const out = await cast(makeSpell(), player);
  assert.deepEqual([out.ok, out.reason, player.calls.spends], [false, "summonRefused", 0]);
  assert.deepEqual(player.calls.texts, [["warn", "ACKS-MAGIC.cast.notice.summonNoGm|{}"]]);
  assert.deepEqual(player.order, ["ask", "verdict"], "before the clicks");
  const judge = runDeps({ answer: answerOf(), isGM: true, gmOnline: false });
  assert.deepEqual([(await cast(makeSpell(), judge)).ok, judge.calls.spends, judge.calls.placed.length], [true, 1, 1]);
  const declare = runDeps({ answer: answerOf(), gmOnline: false, world: fight("cb2") });
  assert.equal((await cast(makeSpell(), declare)).declared, true, "nothing is placed at a declaring, so no GM is needed");
  const online = runDeps({ answer: answerOf() });
  assert.equal((await cast(makeSpell(), online)).ok, true);
});

await ta("a held concentration is warned and ended after the spend and before the new record; one that cannot be ended is logged and the cast goes on", async () => {
  const held = runDeps({ answer: answerOf(), world: { held: true } });
  await cast(makeSpell({ extra: { duration: { shape: "fixed", value: 2, unit: "hours" } } }), held);
  assert.deepEqual(keys(held), ["warn:verdict.concentrating"], "the general warning, naming the caster");
  assert.equal(held.calls.notices[0][2].name, "Invented Caster");
  assert.deepEqual(held.order.slice(held.order.indexOf("spend")), ["spend", "endHeld", "castId", "place", "record", "post"]);
  const none = runDeps({ answer: answerOf() });
  await cast(makeSpell(), none);
  assert.deepEqual(keys(none), [], "no concentration, no warning");
  const failing = runDeps({ answer: answerOf(), world: { held: true } });
  failing.deps.endHeld = async () => {
    throw new Error("no end");
  };
  const logged = [];
  const prior = console.error;
  console.error = (...args) => logged.push(String(args[0]));
  let out;
  try {
    out = await cast(makeSpell(), failing);
  } finally {
    console.error = prior;
  }
  assert.match(logged[0], /concentration could not be ended/);
  assert.deepEqual([out.ok, failing.calls.placed.length, failing.calls.records.length], [true, 1, 1], "the cast happened and leaves its record");
  const cancelled = runDeps({ answer: answerOf(), clicks: null, world: { held: true } });
  await cast(makeSpell(), cancelled);
  assert.equal(cancelled.calls.ended, 0, "a cast that does not happen ends nothing");
});

await ta("a calling is exempt from the range: the clicks and the placement are told so, and a creature no calling row fits is not", async () => {
  const spell = (summonFormat) => makeSpell({ rows: [row({ summonFormat })], extra: { range: { shape: "distance", value: 30, unit: "feet" } } });
  let r = runDeps({ answer: answerOf() });
  await cast(spell("calling"), r);
  assert.deepEqual([r.calls.clicked[0].calling, r.calls.placed[0].calling], [true, true]);
  r = runDeps({ answer: answerOf() });
  await cast(spell("summoning"), r);
  assert.deepEqual([r.calls.clicked[0].calling, r.calls.placed[0].calling], [false, false]);
  const rows = summonRowsOf(spell("calling"), NO_TWIN);
  assert.equal(summonIsCalling(rows, { source: GLIMMER }), true);
  assert.equal(summonIsCalling(rows, { source: { ...GLIMMER, uuid: "x", name: "Other", flags: {} } }), false, "a row that names another creature does not fit");
  assert.equal(summonIsCalling([], { source: GLIMMER }), false);
});

/* ------------------------------------------------------------------ */
/*  Declaring a summons                                               */
/* ------------------------------------------------------------------ */

await ta("a declared summons stores its pick, asks lib nothing and places nothing at the declaring; at its turn it clicks, places and finishes", async () => {
  const stored = [];
  const declare = runDeps({ answer: answerOf(), world: fight("cb2") });
  declare.deps.declare.declare = async (from) => (declare.order.push("declare"), stored.push(from.answer), { castId: "d1" });
  const made = await cast(makeSpell(), declare);
  assert.deepEqual([made.ok, made.declared], [true, true]);
  assert.deepEqual(declare.order, ["ask", "spend", "endHeld", "declare"], "no verdict from lib, no click and no placement at the declaring; the declaring spends once");
  assert.deepEqual(stored[0].summon, { ref: REF, count: 2 });
  const kept = answerStored(stored[0]);
  assert.deepEqual(kept.summon, { ref: REF, count: 2 });
  const pending = { spellUuid: "Actor.c1.Item.sp1", ...kept, combatId: "k1", round: 1, at: 3, targets: [] };
  assert.deepEqual(answerFromPending(pending).summon, { ref: REF, count: 2 });
  const resolve = runDeps({ answer: null, world: { ...fight("cb1"), declarations: [{ castId: "d1", role: "caster", pending }] } });
  const out = await cast(makeSpell(), resolve);
  assert.equal(out.ok, true);
  assert.equal(resolve.calls.asked, 0, "a stored answer that fits asks nothing");
  assert.deepEqual(resolve.order, ["verdict", "clicks", "endHeld", "finish", "castId", "place", "record", "post"], "the click comes at the turn, before the declaration is finished; no second spend");
  assert.deepEqual(resolve.calls.placed[0].pick, { ref: REF, count: 2 });
  const cancel = runDeps({ answer: null, clicks: null, world: { ...fight("cb1"), declarations: [{ castId: "d1", role: "caster", pending }] } });
  assert.equal((await cast(makeSpell(), cancel)).reason, "cancelled");
  assert.deepEqual(cancel.order, ["verdict", "clicks"], "a cancel at the turn's clicks leaves the declaration standing: it is not finished, nothing is spent");
  assert.deepEqual([cancel.calls.finishes, cancel.calls.spends], [0, 0]);
});

await ta("the stored pick is a ref and a whole count of one or more, and nothing else", () => {
  assert.deepEqual(ANSWER_FIELDS.summon({ ref: " r ", count: 3 }), { ref: "r", count: 3 });
  assert.deepEqual(ANSWER_FIELDS.summon({ ref: "r", count: 0 }), { ref: "r", count: 1 });
  assert.deepEqual(ANSWER_FIELDS.summon({ ref: "r", count: 2.5 }), { ref: "r", count: 1 });
  for (const bad of [null, undefined, {}, { ref: "" }, { ref: 4 }, "x"]) assert.equal(ANSWER_FIELDS.summon(bad), null);
});

await ta("a cast that does not proceed places nothing: the tradition's step stopping it posts its section alone, and no record is written", async () => {
  const off = registerCastProcedure(KIND, { perform: async () => ({ proceed: false, section: { title: "Rite", rows: [] }, rolls: [], undo: null }) });
  const r = runDeps({ answer: answerOf(), tradition });
  const out = await cast(makeSpell({ extra: { lists: [{ source: "wisp", level: 1 }] } }), r);
  off();
  assert.deepEqual([out.ok, out.performed], [true, false]);
  assert.deepEqual(r.calls.placed, [], "no creature is made");
  assert.equal(r.calls.records.length, 0);
  assert.equal(r.calls.spends, 1, "the spend stands");
  assert.deepEqual(r.order.slice(-3), ["endHeld", "castId", "post"], "the card is the section alone, and the clicks made nothing");
  assert.ok(!r.order.includes("place") && !r.order.includes("record"));
});

/* ------------------------------------------------------------------ */
/*  The record and its end                                            */
/* ------------------------------------------------------------------ */

await ta("a held summons writes the record heldRecordData returns, whatever its rows; the same as a held cast's", async () => {
  const imported = { shape: "concentrationMax", concentration: "stationary", value: 1, unit: "hours" };
  const read = castDuration(imported, {});
  assert.ok(read.held === "stationary" && read.cap);
  const r = runDeps({ answer: answerOf() });
  const spell = makeSpell({ extra: { duration: imported } });
  await cast(spell, r);
  const mark = { spell: { uuid: spell.uuid, name: spell.name, img: spell.img }, caster: { uuid: spell.parent.uuid }, castId: "castX", role: "caster" };
  assert.deepEqual(r.calls.records[0], heldRecordData(mark, { held: read.held, now: 10, tail: read.tail, cap: read.cap }));
  assert.deepEqual(r.calls.records[0].statuses, ["concentratingStationary"]);
});

await ta("a held summons' end card lists the creatures the cast placed, and each row's Dismiss names that creature and that cast", async () => {
  const imported = { shape: "concentrationMax", concentration: "stationary", value: 1, unit: "hours" };
  const r = runDeps({ answer: answerOf() });
  const spell = makeSpell({ extra: { duration: imported } });
  await cast(spell, r);
  const castId = r.calls.placed[0].castId;
  const placed = r.calls.placed.length ? ["Scene.s1.Token.t0", "Scene.s1.Token.t1"] : [];
  const record = spellEffectOf(r.calls.records[0]);
  const posted = [];
  const flag = await endHeldCast(record, {
    cause: "damage",
    caster: { actorUuid: spell.parent.uuid, name: "Invented Caster", img: "", spellName: spell.name, cite: "", data: r.calls.records[0] },
    deps: {
      now: () => 99,
      recipients: async () => [],
      canWrite: () => true,
      remove: async () => true,
      retime: async () => {},
      post: async (f) => posted.push(f),
      standing: async (rec) => ({ tokens: placed.map((uuid, i) => ({ uuid, name: `Invented Hound ${i}`, texture: { src: "icons/invented-hound.webp" } })), held: rec.castId === castId ? [] : [{ name: "wrong cast" }] }),
    },
  });
  assert.deepEqual(flag.summons.map((c) => c.tokenUuid), placed, "the card lists what the cast placed, by the ids it placed them with");
  const loc = (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key);
  const html = await heldEndContent(flag, loc);
  assert.equal(html.split("data-acks-extras-held-dismiss").length - 1, 3, "a Dismiss on each creature and one for the cast");
  assert.ok(html.includes('data-token-uuid="Scene.s1.Token.t0"') && html.includes('data-token-uuid="Scene.s1.Token.t1"'));
  const asked = [];
  const lib = { caster: spell.parent, castSummons: () => ({}), promptDismiss: async (caster, o) => (asked.push([caster.uuid, o]), { ok: true }) };
  await pressDismiss(flag, { tokenUuid: "Scene.s1.Token.t1" }, lib);
  assert.deepEqual(asked, [[spell.parent.uuid, { entries: [{ tokenUuid: "Scene.s1.Token.t1" }], castId: flag.castId }]]);
  assert.equal(flag.castId, castId, "the cast id the creatures were placed with");
  assert.deepEqual(r.calls.placed.length, 1, "Restore and the end place nothing more");
});

await ta("any other summons is core-timed with no startTime of this module's own, at the caster level; an untimed one carries no duration", async () => {
  const written = async (extra, level) => {
    const r = runDeps({ answer: answerOf(level ? { casterLevel: level } : {}) });
    await cast(makeSpell({ extra, rows: [row({ lasts: "duration" })] }), r);
    return r.calls.records[0];
  };
  const fixed = await written({ duration: { shape: "fixed", value: 2, unit: "hours" } });
  assert.deepEqual([fixed.duration, spellEffectOf(fixed).startTime, fixed.statuses], [{ value: 2, units: "hours" }, undefined, undefined], "even a row that lasts the duration does not make it a flag-timed record");
  const scaled = await written({ duration: { shape: "perLevel", value: 1, unit: "turns" } }, 4);
  const short = await written({ duration: { shape: "perLevel", value: 1, unit: "turns" } }, 2);
  assert.deepEqual([scaled.duration.value, scaled.duration.units, short.duration.units], [2 * short.duration.value, "seconds", "seconds"], "a per-level duration reads the caster level: twice the level, twice the time");
  const none = await written({});
  assert.equal(none.duration, undefined);
});

await ta("a conjuration whose printed duration is no concentration casts held, the printed duration its cap; no other format, and no unreadable duration, does", async () => {
  const written = async (format, duration, over = {}) => {
    const r = runDeps({ answer: answerOf() });
    await cast(makeSpell({ extra: { duration }, rows: [row({ summonFormat: format, ...over })] }), r);
    return r.calls.records[0];
  };
  const printed = { shape: "fixed", value: 2, unit: "hours" };
  const conj = await written("conjuration", printed);
  const read = castDuration(printed, {});
  assert.deepEqual(conj.statuses, ["concentrating"], "the caster holds it");
  assert.deepEqual([spellEffectOf(conj).held, spellEffectOf(conj).duration, spellEffectOf(conj).startTime], ["mobile", read, 10], "flag-timed by the printed duration, so the clock ends it as a held cast");
  for (const format of ["summoning", "calling", undefined]) assert.deepEqual((await written(format, printed)).statuses, undefined, `${format} is core-timed as before`);
  const conc = { shape: "concentrationMax", concentration: "stationary", value: 1, unit: "hours" };
  assert.deepEqual(spellEffectOf(await written("conjuration", conc)).held, "stationary", "a duration that is already a concentration reads as it was");
  assert.equal((await written("conjuration", { shape: "special" })).statuses, undefined, "an unreadable duration has no cap to hold by");
  assert.equal((await written("conjuration", {})).statuses, undefined);
  assert.equal((await written("conjuration", printed, { ref: "def.invented.other" })).statuses, undefined, "a creature no conjuration row names is not conjured");
});

await ta("the pure halves: a conjured creature is one every fitting row calls a conjuration, the held reading wraps only a timed duration, and the end is the first fitting row's word", async () => {
  const { summonIsConjuration, controlEndFor } = await import("../scripts/magic/cast-summon.mjs");
  const { heldByConjuration } = await import("../scripts/magic/cast-duration.mjs");
  const mine = { source: GLIMMER, sourceRef: REF };
  assert.equal(summonIsConjuration([row({ summonFormat: "conjuration" })], mine), true);
  assert.equal(summonIsConjuration([row({ summonFormat: "conjuration" }), row({ summonFormat: "calling" })], mine), false, "every fitting row must say so");
  assert.equal(summonIsConjuration([row({ summonFormat: "conjuration", ref: "def.invented.other" })], mine), false);
  assert.equal(summonIsConjuration([], mine), false);
  assert.deepEqual(heldByConjuration({ value: 6, units: "seconds" }, true), { none: "untimed", held: "mobile", cap: { value: 6, units: "seconds" } });
  const timed = { value: 6, units: "seconds" };
  assert.equal(heldByConjuration(timed, false), timed);
  assert.deepEqual(heldByConjuration({ none: "untimed", held: "stationary", cap: timed }, true), { none: "untimed", held: "stationary", cap: timed });
  assert.deepEqual(heldByConjuration({ none: "noShape" }, true), { none: "noShape" });
  assert.equal(heldByConjuration(undefined, true), undefined);
  assert.equal(controlEndFor([row({ controlEnd: "hostile" })], mine), "hostile");
  assert.equal(controlEndFor([row({ controlEnd: "" }), row({ controlEnd: "gone" })], mine), "gone", "the first fitting row that states one");
  assert.equal(controlEndFor([row()], mine), "stays");
});

await ta("the timed end still posts Dismiss: the record the cast wrote is announced by the clock, with the cast id its creatures carry, and a flag-timed record is deleted instead", async () => {
  const r = runDeps({ answer: answerOf() });
  await cast(makeSpell({ extra: { duration: { shape: "fixed", value: 2, unit: "hours" } } }), r);
  const effect = { id: "e1", uuid: "Actor.c1.ActiveEffect.e1", parent: { uuid: "Actor.c1" }, ...r.calls.records[0], start: { time: 0 } };
  const flagTimed = { id: "e2", uuid: "Actor.c1.ActiveEffect.e2", ...(await (async () => {
    const { spellEffectData } = await import("../scripts/magic/spell-effect.mjs");
    return spellEffectData({ spell: { uuid: "Actor.c1.Item.sp9", name: "Invented", img: "i.png" }, caster: { uuid: "Actor.c1" }, castId: "castY", role: "caster", startTime: 0, duration: { value: 2, units: "hours" } });
  })()) };
  const stamped = [];
  const standing = [];
  const posts = [];
  const removed = [];
  const out = await sweepEndedCasts([{ effects: [effect, flagTimed] }], {
    worldTime: 3 * 3600,
    secondsOf: (value, units) => (units === "hours" ? value * 3600 : null),
    stamp: async (e, time) => stamped.push([e.id, time]),
    remove: async (e) => removed.push(e.id),
    standing: (record) => (standing.push(record.castId), [{ id: "tok" }]),
    post: async (o) => posts.push(o.record.castId),
  });
  assert.deepEqual(out.map((o) => o.posted ?? o.deleted), [true, true]);
  assert.deepEqual(posts, ["castX"], "one card, for the summons' cast");
  assert.deepEqual(standing, ["castX"]);
  assert.equal(posts[0], r.calls.placed[0].castId, "the id the creatures were placed with");
  assert.deepEqual(removed, ["e2"], "the engine-timed record goes silently, as it always did");
  assert.deepEqual(stamped, [["e1", 3 * 3600]]);
});

/* ------------------------------------------------------------------ */
/*  The policy                                                        */
/* ------------------------------------------------------------------ */

await ta("the policy reads the same ceiling at the request's caster level, an invocation level a ladder is keyed on, and never refuses a Judge's count", () => {
  const spell = makeSpell({ rows: [row({ amount: 2, max: perLevel(2, 2) })] });
  const ask = (count, cast, user = PLAYER_SEAT) => summonRefusal({ user, spell, source: GLIMMER, sourceRef: "", count, cast }, NO_TWIN);
  assert.equal(ask(6, { casterLevel: 3 }), null);
  assert.equal(ask(7, { casterLevel: 3 }), "badCount");
  assert.equal(ask(10, { casterLevel: 5 }), null, "the level of the request moves the ceiling");
  assert.equal(ask(30, null), null, "the seat's own pre-check names no level, and a max with no level states no ceiling");
  assert.equal(ask(30, { casterLevel: 3 }, GM_SEAT), null, "a Judge's count is the cast's warning, not a refusal");
  assert.equal(ask(1, { casterLevel: 3 }, { id: "p", isGM: false }), null);
  const ladder = makeSpell({ rows: [row({ amount: 1, max: rungs([1, 2], [3, 5]) })] });
  const asks = (count, invocationLevel) => summonRefusal({ user: PLAYER_SEAT, spell: ladder, source: GLIMMER, count, cast: { casterLevel: 1, invocationLevel } }, NO_TWIN);
  assert.deepEqual([asks(3, 1), asks(5, 3), asks(6, 3)], ["badCount", null, "badCount"]);
  const notNamed = summonRefusal({ user: GM_SEAT, spell, source: { ...GLIMMER, uuid: "x", name: "Other", flags: {} }, count: 1 }, NO_TWIN);
  assert.equal(notNamed, "notNamed", "a creature no row names is refused to a Judge too");
});

await ta("summonCeiling: max at the level, else amount, else none; an invocation ladder reads before the level; a row set apart by its creature fits it", () => {
  assert.equal(summonCeiling(row({ amount: 2 })), 2);
  assert.equal(summonCeiling(row({ amount: 2, max: perLevel(1, 3) }), { level: 3 }), 7);
  assert.equal(summonCeiling(row({ amount: 2, max: perLevel(1, 3) })), null, "a max no level can read states nothing, and amount is not put in its place");
  assert.equal(summonCeiling(row({ amount: 0, max: null })), null);
  assert.equal(summonCeiling(row({ amount: 0, max: { kind: "flat", flat: 0 } })), null);
  assert.equal(summonCeiling(row({ max: rungs([2, 4]) }), { level: 9, at: { invocationLevel: 1 } }), null, "below the first rung");
  assert.equal(summonCeiling(row({ max: rungs([2, 4]) }), { level: 9, at: { invocationLevel: 2 } }), 4);
  const rows = [row({ ref: REF, amount: 2 }), row({ ref: "def.invented.other", amount: 9 })];
  assert.equal(summonCeilingFor(rows, { source: GLIMMER }), 2, "only the row that names the creature");
  assert.equal(summonCeilingFor([...rows, row({ ref: "", amount: 4 })], { source: GLIMMER }), 4, "an open row fits any creature: the greatest ceiling among those that fit");
  assert.equal(summonCeilingFor([...rows, row({ ref: "", amount: 0 })], { source: GLIMMER }), null, "a fitting row with no ceiling lifts the limit");
  assert.equal(summonCeilingFor([], { source: GLIMMER }), null);
});

/* ------------------------------------------------------------------ */
/*  The seam                                                          */
/* ------------------------------------------------------------------ */

await ta("through the seam: the system's cast runs once, only after the clicks, and a cancel at them runs it never", async () => {
  class FakeItem {
    cast = 0;
    async _useSpell() {
      this.cast += 1;
    }
  }
  const prior = { CONFIG: globalThis.CONFIG, libWrapper: globalThis.libWrapper };
  globalThis.CONFIG = { Item: { documentClass: FakeItem } };
  delete globalThis.libWrapper;
  try {
    installSpellUsePatch();
    for (const [clicks, expected] of [[undefined, 1], [null, 0]]) {
      const r = runDeps({ answer: answerOf(), clicks });
      const item = Object.assign(new FakeItem(), makeSpell(), { id: "sp1" });
      addSpellUseClaimant({ ...castSpellClaimant(r.deps), key: "acks-extras.test.summonSeam" });
      try {
        await item._useSpell({});
      } finally {
        removeSpellUseClaimant("acks-extras.test.summonSeam");
      }
      assert.equal(item.cast, expected, `clicks ${clicks === null ? "cancelled" : "made"}: the system's count rises by ${expected}`);
      assert.equal(r.calls.clicked.length, 1, "the clicks were awaited, not left running");
    }
  } finally {
    globalThis.CONFIG = prior.CONFIG;
    if (prior.CONFIG === undefined) delete globalThis.CONFIG;
    if (prior.libWrapper) globalThis.libWrapper = prior.libWrapper;
  }
});

/* ------------------------------------------------------------------ */
/*  The Summon band                                                   */
/* ------------------------------------------------------------------ */

const model = await import("../scripts/magic/apps/cast-dialog-model.mjs");
const bandCite = { cite: "RR 1" };

/** The context a run's dialog is asked with, the dialog cancelling so nothing is cast. */
const askedWith = async (spell, over = {}) => {
  const seen = [];
  const r = runDeps({ answer: null, ...over });
  r.deps.ask = async (ctx) => (seen.push(ctx), null);
  await cast(spell, r);
  return seen[0];
};
/** What the footer of the dialog says of a state: the verdicts as [severity, text] and whether Cast is blocked. */
const footerOf = (ctx, state) => {
  const view = model.dialogContext(ctx, state);
  return { view, verdicts: view.footer.verdicts.map((v) => [v.severity, v.text]), blocked: view.footer.blocked };
};

await ta("the band offers the row's creature by its resolved name and reads its count and ceiling at the level the seat holds; the ceiling's tooltip names the figure, the creature, the caster level and the page", async () => {
  const spell = makeSpell({ rows: [row({ amount: 2, max: perLevel(2, 2) })], extra: bandCite });
  const ctx = await askedWith(spell);
  assert.deepEqual(ctx.summon.creatures.map((c) => [c.value, c.name, c.amount, c.source === GLIMMER]), [[GLIMMER.uuid, "Glimmerkin", 2, true]]);
  const { view } = footerOf(ctx, { casterLevel: "3" });
  const band = view.summon;
  assert.deepEqual([band.show, band.none, band.creature.options], [true, false, [{ value: GLIMMER.uuid, label: "Glimmerkin", selected: true }]]);
  assert.deepEqual([band.count.value, band.count.of, band.count.over], [2, 'ACKS-MAGIC.cast.dialog.summonOf|{"max":6}', false], "the row's own count opens, beside the ceiling at level 3");
  assert.equal(band.count.tip, 'ACKS-MAGIC.cast.tip.summonCeiling|{"max":6,"name":"Glimmerkin","level":3,"cite":" (RR 1)"}');
  assert.equal(model.dialogContext(ctx, { casterLevel: "5" }).summon.count.of, 'ACKS-MAGIC.cast.dialog.summonOf|{"max":10}', "each level reads its own");
  assert.deepEqual(model.answerOf(ctx, { casterLevel: "3" }).summon, { ref: GLIMMER.uuid, count: 2 });
  assert.deepEqual(model.answerOf(ctx, { summon: { ref: GLIMMER.uuid, count: "4" } }).summon, { ref: GLIMMER.uuid, count: 4 }, "a typed count is the answer's");
});

await ta("a creature the seat cannot open is offered by the row's name, else Creature n; rows that name no creature take a dropped one, and Cast waits for it", async () => {
  let ctx = await askedWith(makeSpell({ rows: [row({ ref: "def.invented.far", name: "Far hound" }), row({ ref: "def.invented.unseen", amount: 1 })] }), {});
  assert.deepEqual(model.dialogContext(ctx, {}).summon.creature.options.map((o) => o.label), ["Far hound", 'ACKS-LIB.summons.creatureN|{"n":2}']);
  assert.equal(model.dialogContext(ctx, {}).summon.drop, null, "a spell that names its creatures draws no drop zone");
  ctx = await askedWith(makeSpell({ rows: [row({ ref: "", amount: 2 })] }), {});
  const empty = model.dialogContext(ctx, {});
  assert.deepEqual([empty.summon.none, empty.summon.drop?.empty, empty.summon.counted, "summon" in model.answerOf(ctx, {})], [false, true, false, false]);
  assert.deepEqual([empty.footer.blocked, empty.footer.verdicts.map((v) => v.text.split("|")[0])], [true, ["ACKS-MAGIC.cast.notice.blocked.summonNone"]], "an empty band blocks Cast on every seat");
  const state = { summon: { ref: "Compendium.invented.Actor.z", count: "", name: "Zebra", img: "z.png" } };
  const held = model.dialogContext(ctx, state);
  assert.deepEqual([held.summon.drop.rows.map((r) => [r.uuid, r.name, r.img]), held.summon.counted, held.footer.blocked], [[["Compendium.invented.Actor.z", "Zebra", "z.png"]], true, false]);
  assert.deepEqual(model.answerOf(ctx, state).summon, { ref: "Compendium.invented.Actor.z", count: 2 }, "the dropped creature opens on the open row's count");
  ctx = await askedWith(makeSpell({ rows: [] }), {});
  assert.equal(model.dialogContext(ctx, {}).summon.drop?.empty, true, "a rowless summoning spell takes a dropped creature too");
});

await ta("a family picked for a cast that places now is made one creature first, and that creature is placed; a closed variant dialog spends nothing", async () => {
  const family = { uuid: "Compendium.invented.Actor.fam", name: "Invented family", type: "acks-extras.template", flags: {} };
  const madeOne = { uuid: "Actor.made", name: "Invented family, small", type: "monster", flags: { "acks-extras": { generated: { templateUuid: family.uuid } } } };
  const r = runDeps({ answer: answerOf({ summon: { ref: family.uuid, count: 1 } }) });
  const resolve = r.deps.resolveRef;
  r.deps.resolveRef = async (ref) => (ref === family.uuid ? family : ref === madeOne.uuid ? madeOne : resolve(ref));
  const asked = [];
  r.deps.summonVariant = async (_caster, fam) => (r.order.push("variant"), asked.push(fam.uuid), madeOne);
  await cast(makeSpell({ rows: [row({ ref: "" })] }), r);
  assert.deepEqual(asked, [family.uuid], "the variant is asked once, of the family");
  assert.deepEqual(r.order.slice(0, 4), ["ask", "variant", "verdict", "clicks"], "the creature is made before lib's checks and the clicks");
  assert.deepEqual([r.calls.verdicts[0]?.sourceUuid, r.calls.clicked[0]?.sourceUuid], [madeOne.uuid, madeOne.uuid], "the made creature is what is checked and placed");
  const shut = runDeps({ answer: answerOf({ summon: { ref: family.uuid, count: 1 } }) });
  shut.deps.resolveRef = r.deps.resolveRef;
  shut.deps.summonVariant = async () => null;
  const out = await cast(makeSpell({ rows: [row({ ref: "" })] }), shut);
  assert.deepEqual([out.ok, out.reason, shut.calls.spends], [false, "cancelled", 0]);
});

await ta("a row that names a family names every creature made from it, by the family's uuid or importer id", () => {
  const madeOne = { uuid: "Actor.made", name: "Small one", type: "monster", flags: { "acks-extras": { generated: { templateUuid: "Compendium.invented.Actor.fam", templateRef: "def.invented.family" } } } };
  assert.equal(summonFitting([row({ ref: "def.invented.family" })], { source: madeOne }).length, 1);
  assert.equal(summonFitting([row({ ref: "Compendium.invented.Actor.fam" })], { source: madeOne }).length, 1);
  assert.equal(summonFitting([row({ ref: "def.invented.other" })], { source: madeOne }).length, 0);
});

await ta("a blank ceiling shows the page reference alone, and no count is held against it", async () => {
  const ctx = await askedWith(makeSpell({ rows: [row({ amount: 0 })], extra: bandCite }));
  const band = model.dialogContext(ctx, { summon: { ref: GLIMMER.uuid, count: "9" } }).summon;
  assert.deepEqual([band.count.of, band.count.tip, band.count.over], ["", "RR 1", false]);
  assert.deepEqual(footerOf(ctx, { summon: { ref: GLIMMER.uuid, count: "9" } }).verdicts, []);
  const bare = model.dialogContext(await askedWith(makeSpell({ rows: [row({ amount: 0 })] })), {}).summon;
  assert.equal(bare.count.tip, "", "with no reference either, there is none to show");
});

await ta("the placement line reads the spell's range in feet from the caster, a calling arrives on its own, and a spell stating no range says how the places are chosen", async () => {
  const at = async (rows, extra, level = "3") => model.dialogContext(await askedWith(makeSpell({ rows, extra: { ...bandCite, ...extra } })), { casterLevel: level }).summon.placement;
  let placement = await at([row()], { range: { shape: "distancePerLevel", value: 10, unit: "feet" } });
  assert.deepEqual([placement.text, placement.tip], ['ACKS-MAGIC.cast.dialog.summonWithin|{"feet":30,"name":"Invented Caster"}', 'ACKS-MAGIC.cast.tip.summonRange|{"feet":30,"level":3,"cite":" (RR 1)"}']);
  placement = await at([row({ summonFormat: "calling" })], { range: { shape: "distance", value: 30, unit: "feet" } });
  assert.deepEqual([placement.text, placement.tip], ["ACKS-MAGIC.cast.dialog.summonCalled|{}", ""]);
  placement = await at([row()], {});
  assert.deepEqual([placement.text, placement.tip], ["ACKS-MAGIC.cast.dialog.summonOpen|{}", "RR 1"]);
});

await ta("the footer carries the count's verdict before the confirm: it blocks a Player's Cast and only warns a Judge's, with the page on its tooltip", async () => {
  const spell = () => makeSpell({ rows: [row({ amount: 2, max: perLevel(2, 2) })], extra: bandCite });
  const over = { casterLevel: "3", summon: { ref: GLIMMER.uuid, count: "7" } };
  const blocking = `ACKS-MAGIC.cast.notice.blocked.summonCount|{"name":"Invented Caster","names":"","max":6,"over":1}`;
  const player = footerOf(await askedWith(spell()), over);
  assert.deepEqual([player.verdicts, player.blocked], [[["block", blocking]], true]);
  assert.equal(player.view.footer.verdicts[0].tip, 'ACKS-MAGIC.cast.tip.cite|{"cite":"RR 1"}');
  const judge = footerOf(await askedWith(spell(), { isGM: true }), over);
  assert.deepEqual([judge.verdicts.map(([severity]) => severity), judge.blocked], [["warn"], false]);
  assert.deepEqual(footerOf(await askedWith(spell()), { ...over, summon: { ref: GLIMMER.uuid, count: "6" } }).verdicts, [], "the ceiling itself is allowed");
});

await ta("no GM connected shows in a Player's footer before the confirm and blocks Cast; a Judge's seat and a declaring show none", async () => {
  const noGm = 'ACKS-MAGIC.cast.notice.summonNoGm|{}';
  const player = footerOf(await askedWith(makeSpell(), { gmOnline: false }), {});
  assert.deepEqual([player.verdicts, player.blocked], [[["block", noGm]], true]);
  assert.deepEqual(footerOf(await askedWith(makeSpell(), { gmOnline: false, isGM: true }), {}).verdicts, []);
  assert.deepEqual(footerOf(await askedWith(makeSpell(), { gmOnline: false, world: fight("cb2") }), {}).verdicts, [], "nothing is placed at a declaring");
});

await ta("no slot or pool, and a casting time over a round in a fight, reach the footer of a summons as they do any cast: a Player is blocked and a Judge warned", async () => {
  const slotless = { verdict: "none" };
  const spell = () => makeSpell({ extra: { castingTime: { shape: "timed", value: 3, unit: "turns" } } });
  const fights = fight("cb1");
  const keysOf = (c) => footerOf(c, {}).view.footer.verdicts.map((v) => v.text);
  const player = await askedWith(spell(), { capacity: slotless, world: fights });
  assert.deepEqual(keysOf(player), ["ACKS-MAGIC.cast.notice.blocked.noSlot|" + JSON.stringify({ name: "Invented Caster", names: "", max: "", over: "" }), "ACKS-MAGIC.cast.notice.blocked.longCast|" + JSON.stringify({ name: "Invented Caster", names: "", max: "", over: "" })]);
  assert.equal(footerOf(player, {}).blocked, true);
  const judge = footerOf(await askedWith(spell(), { capacity: slotless, world: fights, isGM: true }), {});
  assert.deepEqual([judge.view.footer.verdicts.map((v) => v.severity), judge.blocked], [["warn", "warn"], false]);
});

await ta("the band's answer is the cast's pick: no shelf prompt, the count it holds is the one weighed, spent against and placed, and a declaration reopens on it", async () => {
  const spell = () => makeSpell({ rows: [row({ amount: 2, max: perLevel(2, 2) })], extra: bandCite });
  const r = runDeps({ answer: null, isGM: true });
  let ctx;
  r.deps.ask = async (c) => (ctx = c, r.order.push("ask"), model.answerOf(c, { casterLevel: "3", summon: { ref: GLIMMER.uuid, count: "7" } }));
  const out = await cast(spell(), r);
  assert.equal(out.ok, true);
  assert.deepEqual(r.order.filter((step) => step === "pickSummon"), [], "the shelf prompt is the fallback only");
  assert.deepEqual([r.calls.placed[0].pick, r.calls.verdicts[0]], [{ ref: GLIMMER.uuid, count: 7 }, { sourceUuid: GLIMMER.uuid, count: 7, spellId: "sp1" }]);
  assert.deepEqual(keys(r), ["warn:verdict.summonCount"], "a Judge's count over the ceiling is warned, as the footer said");
  assert.ok(r.calls.posts[0].lines.some((l) => l.startsWith("ACKS-MAGIC.cast.line.summonedOpen|") && l.includes('"name":"Glimmerkin","n":2')), "the card names the creature and the clicks' two places");
  const state = model.initialState({ ...ctx, initial: { summon: { ref: GLIMMER.uuid, count: 5 } } });
  assert.deepEqual(state.summon, { ref: GLIMMER.uuid, count: "5" });
});

await ta("the card's summon line says how long the spell lasts as it is written (a level-scaled and a concentration length too), nothing for an instant, and a click that made no creature is its own line", async () => {
  const lineFor = async (duration, over = {}) => {
    const r = runDeps({ answer: answerOf(), ...over });
    await cast(makeSpell({ extra: { duration } }), r);
    return r.calls.posts[0].lines.filter((l) => l.includes("line.summon"));
  };
  assert.deepEqual(await lineFor({ shape: "perLevel", value: 1, unit: "turns" }), ['ACKS-MAGIC.cast.line.summoned|{"name":"Glimmerkin","n":2,"duration":"1 turn/level"}']);
  assert.deepEqual(await lineFor({ shape: "concentration", concentration: "mobile" }), ['ACKS-MAGIC.cast.line.summoned|{"name":"Glimmerkin","n":2,"duration":"concentration"}']);
  assert.deepEqual(await lineFor({ shape: "instantaneous" }), ['ACKS-MAGIC.cast.line.summonedOpen|{"name":"Glimmerkin","n":2,"duration":""}']);
  const short = await lineFor({ shape: "fixed", value: 1, unit: "hours" }, { place: (ctx) => ({ ok: true, castId: ctx.castId, tokenUuids: ["Scene.s1.Token.t0"] }) });
  assert.deepEqual(short, ['ACKS-MAGIC.cast.line.summoned|{"name":"Glimmerkin","n":1,"duration":"1 hour"}', 'ACKS-MAGIC.cast.line.summonShort|{"n":1}']);
});

await ta("a count under one reads as one, and a targeted token the summons never draws raises no verdict in its footer", async () => {
  const ctx = await askedWith(makeSpell({ rows: [row({ amount: 2 })], extra: { ...bandCite, range: { shape: "distance", value: 30, unit: "feet" } } }), { world: { tokens: [{ uuid: "Scene.s1.Token.far", name: "Far token", actor: {} }], gaps: { "Scene.s1.Token.far": 500 } } });
  assert.deepEqual(model.answerOf(ctx, { summon: { ref: GLIMMER.uuid, count: "0" } }).summon, { ref: GLIMMER.uuid, count: 1 });
  assert.equal(model.dialogContext(ctx, {}).summon.count.value, 2);
  const { view, verdicts } = footerOf(ctx, {});
  assert.deepEqual([view.summon.show, verdicts], [true, []], "the targets are not drawn, and none is held against the cast");
});

console.log(`\n${n} cast-summon tests passed`);
