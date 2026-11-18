/**
 * Offline tests for the power ledger: the model (`scripts/magic/power-ledger.mjs`),
 * its live wrapper (`power-ledger-live.mjs`: the calendar's unit lengths, the
 * imported lifetimes, the write and the GM relay) and the chip the classes strip
 * hosts (`scripts/classes/power-chip.mjs`). Mocked Foundry globals; every figure,
 * lifetime, calendar and name below is invented, so this file carries no book
 * content.
 *
 * Usage: node tools/test-power-ledger.mjs
 */
import assert from "node:assert/strict";

/** A localizer that echoes the key and its data, so a test reads what a string was asked for. */
const echo = (key, data) => (data && Object.keys(data).length ? `${key}${JSON.stringify(data)}` : key);

globalThis.Hooks = { on() {}, once() {} };
globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`), randomID: (() => { let i = 0; return () => `id${++i}`; })() } };
const gameState = { isGM: true, worldTime: 5 * 86400, calendar: { days: { daysPerYear: 360, values: new Array(7).fill({}) }, months: { values: new Array(12).fill({}) } }, actors: new Map(), users: new Map() };
globalThis.game = {
  i18n: { format: echo, localize: (k) => k },
  get user() {
    return { id: gameState.isGM ? "gm1" : "pl1", isGM: gameState.isGM };
  },
  users: { get: (id) => gameState.users.get(id), activeGM: { id: "gm1" } },
  time: {
    get worldTime() {
      return gameState.worldTime;
    },
    get calendar() {
      return gameState.calendar;
    },
  },
};
globalThis.ui = { notifications: { warn: (m) => (gameState.warned ??= []).push(m) } };
globalThis.fromUuidSync = (uuid) => gameState.actors.get(uuid) ?? null;

const P = await import("../scripts/magic/power-ledger.mjs");
const L = await import("../scripts/magic/power-ledger-live.mjs");
const C = await import("../scripts/classes/power-chip.mjs");
const { POWER_HANDLER } = await import("../scripts/magic/constants.mjs");
const { PRIORITY, registerTable, resetTables } = await import("../scripts/lib/tables.mjs");

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

const e = (id, amount, day, extra = {}) => ({ id, amount, day, name: "", img: "", ref: "", by: "", ...extra });

/* ------------------------------- the entries ------------------------------- */

t("an entry is cleaned to its shape, and one that moves nothing or has no id is dropped", () => {
  assert.deepEqual(P.cleanEntry({ id: "a", amount: "3.9", day: "4", name: 7, by: "judge", extra: 1 }), { id: "a", amount: 3, day: 4, name: "7", img: "", ref: "", by: "judge" });
  assert.equal(P.cleanEntry({ id: "a", amount: 0 }), null);
  assert.equal(P.cleanEntry({ id: "", amount: 2 }), null);
  assert.equal(P.cleanEntry({ amount: 2 }), null);
  assert.equal(P.cleanEntry(null), null);
  assert.equal(P.cleanEntry({ id: "a", amount: 2, day: "x" }).day, null, "a day that is no number is a lot with no stamp");
  assert.equal(P.cleanEntry({ id: "a", amount: 2, by: "someone" }).by, "", "only a Judge's hand is a mark");
});

t("the count is a whole number of at least one, else blank", () => {
  assert.equal(P.cleanCount(3), 3);
  assert.equal(P.cleanCount("4.8"), 4);
  for (const bad of [0, -2, "", null, undefined, "x", NaN]) assert.equal(P.cleanCount(bad), null, String(bad));
});

t("the stored flag reads as a ledger, whatever shape it has", () => {
  assert.deepEqual(P.readLedger(undefined), { divine: { entries: [] }, arcane: { entries: [], count: null } });
  assert.deepEqual(P.readLedger("junk"), { divine: { entries: [] }, arcane: { entries: [], count: null } });
  const led = P.readLedger({ divine: { entries: [{ id: "a", amount: 2, day: 1 }, { id: "b", amount: 0 }, 5] }, arcane: { entries: "no", count: "6" } });
  assert.equal(led.divine.entries.length, 1);
  assert.deepEqual(led.arcane, { entries: [], count: 6 });
});

/* --------------------------------- lifetimes --------------------------------- */

t("a span is whole days by the calendar's unit lengths; an absent, unreadable or unconvertible one is null", () => {
  const units = { day: 1, week: 6, month: 30, year: 360 };
  assert.equal(P.spanDays({ count: 3, unit: "week" }, units), 18);
  assert.equal(P.spanDays({ count: 2, unit: "day" }, units), 2);
  assert.equal(P.spanDays({ count: 1.5, unit: "week" }, { ...units, week: 6.5 }), 10, "a fraction of a day rounds up");
  assert.equal(P.spanDays({ count: 3, unit: "fortnight" }, units), null, "a unit the ledger does not convert");
  assert.equal(P.spanDays({ count: 3, unit: "month" }, { day: 1 }), null, "a calendar that cannot say the unit");
  for (const bad of [{ count: null, unit: "day" }, { count: 0, unit: "day" }, { count: -1, unit: "day" }, { unit: "day" }, null, undefined]) assert.equal(P.spanDays(bad, units), null, JSON.stringify(bad));
});

/* ----------------------------- balance and expiry ----------------------------- */

t("spent power takes from the oldest lot; a lot expires once a whole span has passed since its day", () => {
  const entries = [e("a", 10, 0), e("b", 5, 10), e("s", -4, 12)];
  assert.equal(P.balanceOf(entries, 29, 30), 11, "6 left of the first and all 5 of the second");
  assert.equal(P.balanceOf(entries, 30, 30), 5, "the first lot's day is day zero of it, so a whole span later it is gone");
  assert.equal(P.balanceOf(entries, 39, 30), 5);
  assert.equal(P.balanceOf(entries, 40, 30), 0);
  assert.equal(P.balanceOf(entries, 9999, null), 11, "with no span nothing expires");
  assert.equal(P.balanceOf([], 5, 30), 0);
});

t("a lot that had expired by a spend's day was never drawn on", () => {
  const entries = [e("a", 10, 0), e("b", 5, 20), e("s", -3, 35)];
  const lots = P.standing(entries, 36, 30);
  assert.deepEqual(lots.map((l) => [l.id, l.left, l.expired, l.expiresDay]), [["a", 10, true, 30], ["b", 2, false, 50]]);
  assert.equal(P.balanceOf(entries, 36, 30), 2);
});

t("spending beyond what is held never takes the balance below nothing", () => {
  assert.equal(P.balanceOf([e("a", 3, 1), e("s", -5, 2)], 3, 30), 0);
  assert.equal(P.balanceOf([e("s", -5, 2), e("a", 3, 3)], 4, 30), 3, "a spend before any gain drew on nothing");
});

t("a lot with no day stamp never expires", () => {
  const entries = [e("a", 4, null)];
  assert.equal(P.balanceOf(entries, 9999, 30), 4);
  assert.equal(P.standing(entries, 9999, 30)[0].expiresDay, null);
});

t("the next expiry is the soonest day a live lot with something left goes, summing that day's lots", () => {
  const entries = [e("a", 6, 0), e("b", 5, 10), e("c", 2, 10)];
  assert.deepEqual(P.nextExpiry(entries, 5, 30), { day: 30, amount: 6, inDays: 25 });
  assert.deepEqual(P.nextExpiry(entries, 30, 30), { day: 40, amount: 7, inDays: 10 });
  assert.equal(P.nextExpiry(entries, 40, 30), null, "everything has gone");
  assert.equal(P.nextExpiry(entries, 5, null), null, "no span, nothing fades");
  assert.equal(P.nextExpiry([e("a", 4, 0), e("s", -4, 1)], 5, 30), null, "a lot spent to nothing does not fade");
});

t("taking a spend back is a delete and a recompute", () => {
  let led = P.readLedger({ divine: { entries: [e("a", 8, 0), e("s", -5, 1)] } });
  assert.equal(P.balanceOf(led.divine.entries, 2, null), 3);
  led = P.withoutEntry(led, "divine", "s");
  assert.equal(P.balanceOf(led.divine.entries, 2, null), 8);
  assert.equal(P.withoutEntry(led, "nonsense", "a"), led);
});

t("an entry is appended after the others, and one that moves nothing leaves the ledger as it was", () => {
  const led = P.readLedger(null);
  const a = P.withEntry(led, "arcane", e("a", 2, 1));
  assert.deepEqual(P.withEntry(a, "arcane", e("b", 3, 2)).arcane.entries.map((x) => x.id), ["a", "b"]);
  assert.equal(P.withEntry(led, "arcane", e("z", 0, 1)), led);
  assert.equal(P.withEntry(led, "nonsense", e("z", 1, 1)), led);
  assert.equal(P.withArcaneCount(a, "5").arcane.count, 5);
  assert.deepEqual(P.withArcaneCount(a, 5).arcane.entries.length, 1, "the count leaves the entries");
});

/* ----------------------------------- spending ----------------------------------- */

t("a spend within the balance is as asked; beyond it a Player is blocked and a Judge is warned", () => {
  assert.deepEqual(P.planSpend({ amount: 3, balance: 5, judge: false }), { ok: true, amount: 3 });
  assert.deepEqual(P.planSpend({ amount: 5, balance: 5, judge: false }), { ok: true, amount: 5 });
  assert.deepEqual(P.planSpend({ amount: 6, balance: 5, judge: false }), { ok: false, reason: "short" });
  assert.deepEqual(P.planSpend({ amount: 6, balance: 5, judge: true }), { ok: true, amount: 5, warn: "short" });
  assert.deepEqual(P.planSpend({ amount: 6, balance: 0, judge: true }), { ok: true, amount: 0, warn: "short" });
  assert.deepEqual(P.planSpend({ amount: 0, balance: 5, judge: true }), { ok: false, reason: "amount" });
  assert.deepEqual(P.planSpend({ amount: "x", balance: 5, judge: false }), { ok: false, reason: "amount" });
});

t("a bucket's power row is capped by the whole power held, and there is none where nothing is held", () => {
  const row = P.powerRow({ kind: "divine", name: "Divine", amount: 9, balance: 5.7 });
  assert.deepEqual([row.uuid, row.kind, row.qty, row.cap], ["power:divine", "power", 5, 5]);
  assert.equal(P.powerRow({ kind: "divine", name: "Divine", amount: 2, balance: 5 }).qty, 2);
  assert.equal(P.powerRow({ kind: "divine", name: "Divine", balance: 0 }), null, "lib's powerEntry would count one under a cap of nothing");
  assert.equal(P.powerRow({ kind: "divine", name: "Divine", balance: 0.9 }), null);
  assert.equal(P.powerRow({ kind: "divine", name: "Divine", balance: NaN }), null);
  assert.equal(P.powerRow({ kind: "other", name: "x", balance: 4 }), null);
  const valued = P.powerRow({ kind: "arcane", name: "Arcane", amount: 3, balance: 9, value: { gp: null, each: 2, source: "power" } });
  assert.equal(valued.value.gp, 6, "a per-unit value rescales with the quantity");
  assert.equal(P.kindOfRow("power:arcane"), "arcane");
  assert.equal(P.kindOfRow("power:other"), null);
  assert.equal(P.kindOfRow("Actor.a1"), null);
});

/* ------------------------------ who may ask for what ------------------------------ */

t("a relayed request is decided on who sent it", () => {
  const actor = {};
  const ok = (req, who) => P.checkPowerRequest(req, { actor, ...who });
  assert.deepEqual(ok({ kind: "divine", op: "gain", args: { amount: 1 } }, { fromJudge: false, owns: true }), { ok: true });
  assert.deepEqual(ok({ kind: "divine", op: "spend", args: {} }, { fromJudge: false, owns: true }), { ok: true });
  assert.deepEqual(ok({ kind: "divine", op: "gain", args: {} }, { fromJudge: false, owns: false }), { refused: "owner" });
  assert.deepEqual(ok({ kind: "divine", op: "undo", args: {} }, { fromJudge: false, owns: true }), { refused: "judge" });
  assert.deepEqual(ok({ kind: "arcane", op: "count", args: {} }, { fromJudge: false, owns: true }), { refused: "judge" });
  assert.deepEqual(ok({ kind: "divine", op: "gain", args: { by: "judge" } }, { fromJudge: false, owns: true }), { refused: "judge" }, "a hand's mark is the Judge's");
  assert.deepEqual(ok({ kind: "divine", op: "undo", args: {} }, { fromJudge: true, owns: false }), { ok: true });
  assert.deepEqual(ok({ kind: "nope", op: "gain" }, { fromJudge: true, owns: true }), { refused: "kind" });
  assert.deepEqual(ok({ kind: "divine", op: "nope" }, { fromJudge: true, owns: true }), { refused: "op" });
  assert.deepEqual(P.checkPowerRequest({ kind: "divine", op: "gain" }, { actor: null, fromJudge: true, owns: true }), { refused: "noActor" });
});

/* -------------------------------------- ops -------------------------------------- */

/** A stored flag and the dependencies over it: the seat's own rights and the relay it sends to. */
function rig({ judge = true, canWrite = true, span = null, relayAnswer = undefined } = {}) {
  const r = { flag: undefined, writes: 0, today: 100, relays: [], span };
  let id = 0;
  r.actor = { uuid: "Actor.hero" };
  r.deps = {
    read: () => r.flag,
    write: async (actor, kind, next) => {
      r.writes++;
      r.flag = { ...(r.flag ?? {}), [kind]: next };
    },
    canWrite: () => canWrite,
    relay: async (request) => {
      r.relays.push(request);
      return relayAnswer;
    },
    today: () => r.today,
    isJudge: () => judge,
    lifetime: () => r.span,
    newId: () => `e${++id}`,
  };
  r.ops = P.powerOps(r.deps);
  return r;
}

await ta("a Judge gains and spends; the entries carry the day, the source and the cast", async () => {
  const r = rig();
  const gained = await r.ops.gain(r.actor, "divine", { amount: 8, name: "Sacrifice: bandit chief", img: "icons/x.svg", ref: "cast1" });
  assert.deepEqual(gained, { ok: true, id: "e1", amount: 8, balance: 8 });
  assert.deepEqual(r.flag.divine.entries[0], { id: "e1", amount: 8, day: 100, name: "Sacrifice: bandit chief", img: "icons/x.svg", ref: "cast1", by: "" });
  const spent = await r.ops.spend(r.actor, "divine", { amount: 3, name: "Spent: ritual", ref: "cast2" });
  assert.deepEqual(spent, { ok: true, amount: 3, id: "e2", balance: 5 });
  assert.equal(r.flag.divine.entries[1].amount, -3);
  assert.equal(r.ops.balance(r.actor, "divine"), 5);
  assert.equal(r.ops.balance(r.actor, "arcane"), 0);
  assert.equal(r.ops.balance(r.actor, "nonsense"), 0);
  assert.deepEqual(await r.ops.gain(r.actor, "divine", { amount: 0 }), { ok: false, reason: "amount" });
  assert.deepEqual(await r.ops.gain(r.actor, "nonsense", { amount: 1 }), { ok: false, reason: "kind" });
  assert.equal(r.writes, 2, "a refusal writes nothing");
});

await ta("a Judge's spend beyond the balance takes what is held and warns; with nothing held it writes nothing", async () => {
  const r = rig();
  await r.ops.gain(r.actor, "arcane", { amount: 4, name: "x" });
  const short = await r.ops.spend(r.actor, "arcane", { amount: 9, name: "ritual" });
  assert.deepEqual([short.ok, short.amount, short.warn, short.balance], [true, 4, "short", 0]);
  const writes = r.writes;
  const none = await r.ops.spend(r.actor, "arcane", { amount: 2 });
  assert.deepEqual([none.ok, none.amount, none.warn], [true, 0, "short"]);
  assert.equal(r.writes, writes);
});

await ta("a Player is blocked beyond the balance and from the Judge's own acts, and nothing is written", async () => {
  const r = rig({ judge: false, canWrite: true });
  r.flag = { divine: { entries: [e("a", 3, 90)] } };
  assert.deepEqual(await r.ops.spend(r.actor, "divine", { amount: 4 }), { ok: false, reason: "short" });
  assert.deepEqual(await r.ops.gain(r.actor, "divine", { amount: 1, by: "judge" }), { ok: false, reason: "judge" });
  assert.deepEqual(await r.ops.undo(r.actor, "divine", "a"), { ok: false, reason: "judge" });
  assert.deepEqual(await r.ops.setCount(r.actor, 3), { ok: false, reason: "judge" });
  assert.equal(r.writes, 0);
  assert.equal((await r.ops.spend(r.actor, "divine", { amount: 3 })).ok, true, "within the balance a Player's write stands");
  assert.equal(r.flag.divine.entries.at(-1).by, "");
});

await ta("a seat that cannot write the actor asks the GM's client, and an unanswered ask is not a write", async () => {
  const none = rig({ judge: false, canWrite: false });
  assert.deepEqual(await none.ops.gain(none.actor, "divine", { amount: 2, name: "x" }), { ok: false, reason: "noGm" });
  assert.deepEqual(none.relays, [{ actorUuid: "Actor.hero", kind: "divine", op: "gain", args: { amount: 2, name: "x" } }]);
  assert.equal(none.writes, 0);
  const answered = rig({ judge: false, canWrite: false, relayAnswer: { ok: true, balance: 2 } });
  assert.deepEqual(await answered.ops.gain(answered.actor, "divine", { amount: 2 }), { ok: true, balance: 2 });
  assert.equal(answered.writes, 0, "the write is the GM client's");
  const judgeAsk = rig({ judge: true, canWrite: false, relayAnswer: { ok: true } });
  await judgeAsk.ops.undo(judgeAsk.actor, "divine", "q");
  assert.equal(judgeAsk.relays.length, 1);
});

await ta("on the GM's client a relayed request runs as its sender: a Player's mark by hand is not kept", async () => {
  const r = rig({ judge: true });
  await r.ops.apply(r.actor, "divine", "gain", { amount: 2, by: "judge" }, false);
  assert.equal(r.flag.divine.entries[0].by, "", "the mark is the Judge's");
  await r.ops.apply(r.actor, "divine", "gain", { amount: 2, by: "judge" }, true);
  assert.equal(r.flag.divine.entries[1].by, "judge");
  const over = await r.ops.apply(r.actor, "divine", "spend", { amount: 99 }, false);
  assert.deepEqual(over, { ok: false, reason: "short" });
});

await ta("an undo takes back a spend only, and the power returns", async () => {
  const r = rig();
  await r.ops.gain(r.actor, "divine", { amount: 8, name: "g" });
  const spend = await r.ops.spend(r.actor, "divine", { amount: 5, name: "s" });
  assert.equal(r.ops.balance(r.actor, "divine"), 3);
  assert.deepEqual(await r.ops.undo(r.actor, "divine", "e1"), { ok: false, reason: "undo" }, "a gain is not undone here");
  assert.deepEqual(await r.ops.undo(r.actor, "divine", "nope"), { ok: false, reason: "undo" });
  assert.deepEqual(await r.ops.undo(r.actor, "divine", spend.id), { ok: true, balance: 8 });
  assert.equal(r.flag.divine.entries.length, 1);
});

await ta("the arcane count is written beside the entries and blanked by a non-number", async () => {
  const r = rig();
  await r.ops.gain(r.actor, "arcane", { amount: 2, name: "x" });
  assert.deepEqual(await r.ops.setCount(r.actor, "4"), { ok: true, count: 4 });
  assert.equal(r.flag.arcane.count, 4);
  assert.equal(r.flag.arcane.entries.length, 1);
  assert.deepEqual(await r.ops.setCount(r.actor, ""), { ok: true, count: null });
  assert.equal(r.flag.arcane.count, null);
});

await ta("expiry reads at the day it is asked, and nothing is written as time moves", async () => {
  const r = rig({ span: 10 });
  await r.ops.gain(r.actor, "divine", { amount: 6, name: "g" });
  const writes = r.writes;
  r.today = 109;
  assert.equal(r.ops.balance(r.actor, "divine"), 6);
  r.today = 110;
  assert.equal(r.ops.balance(r.actor, "divine"), 0);
  assert.deepEqual(await r.ops.spend(r.actor, "divine", { amount: 1 }), { ok: true, amount: 0, warn: "short", balance: 0 }, "power that has faded is not there to spend");
  r.today = 100;
  assert.equal(r.ops.balance(r.actor, "divine"), 6, "a dragged-back clock gives the power back, as nothing was removed");
  assert.equal(r.writes, writes, "neither the faded day nor the spend of nothing wrote");
});

/* --------------------------------- the chip model --------------------------------- */

const ledgerOf = (raw) => P.readLedger(raw);
const lives = (over = {}) => ({ divine: { span: null, lifetime: null, cite: null, byHand: false }, arcane: { span: null, lifetime: null, cite: null, byHand: false }, ...over });
const model = (raw, o = {}) => P.chipModel({ ledger: ledgerOf(raw), today: 10, lifetimes: lives(), loc: echo, judge: false, ...o });

t("a Player's chip shows a kind with entries, no controls and no count; a Judge's shows both kinds", () => {
  const raw = { divine: { entries: [e("a", 4, 1, { name: "Sacrifice: bandit chief" })] } };
  const player = model(raw);
  assert.deepEqual(player.kinds.map((k) => [k.kind, k.shown]), [["divine", true], ["arcane", false]]);
  assert.equal(player.any, true);
  assert.equal(player.kinds.find((k) => k.kind === "arcane").count, null);
  const judge = model(raw, { judge: true });
  assert.deepEqual(judge.kinds.map((k) => k.shown), [true, true]);
  assert.ok(judge.kinds[1].count && judge.kinds[1].count.value === "", "the count is blank until set");
  assert.equal(judge.kinds[0].count, null, "only arcane has a count");
  assert.equal(model({}).any, false, "a Player with nothing sees no chip");
  assert.equal(model({}, { judge: true }).any, true);
  assert.equal(model({}, { judge: true }).hasEntries, false);
});

t("the tooltip lists the entries, the next fading and the page; an overridden lifetime names no page", () => {
  const raw = { divine: { entries: [e("a", 8, 1, { name: "Sacrifice: bandit chief" }), e("s", -3, 2, { name: "Spent: ritual" })] } };
  const life = lives({ divine: { span: 30, lifetime: { count: 1, unit: "month" }, cite: "RR 9", byHand: false } });
  const k = model(raw, { lifetimes: life }).kinds[0];
  assert.equal(k.balance, 5);
  assert.ok(k.tip.startsWith('tipHead{"label":"kind.divine","balance":5}: Sacrifice: bandit chief +8 · Spent: ritual −3'), k.tip);
  assert.ok(k.tip.includes('tipFades{"n":5,"days":21,"day":31}'), k.tip);
  assert.ok(k.tip.endsWith(" (RR 9)"), k.tip);
  const hand = model(raw, { lifetimes: lives({ divine: { span: 30, lifetime: { count: 1, unit: "month" }, cite: "RR 9", byHand: true } }) }).kinds[0];
  assert.ok(hand.tip.includes("tipByHand") && !hand.tip.includes("RR 9") && !hand.tip.includes("cite."), hand.tip);
  const bare = model({ divine: { entries: [e("a", 1, 1)] } }).kinds[0];
  assert.ok(bare.tip.endsWith(" (cite.divine)"), "with nothing imported the page reference is the shipped one alone");
  assert.ok(!bare.tip.includes("tipFades"), "and nothing fades");
  assert.ok(model({}, { judge: true }).kinds[0].tip.includes(": empty"), "an empty ledger says so in the board's words");
});

t("the rows run newest first; a spend carries Undo for a Judge alone; an expired lot is dimmed with its reason", () => {
  const raw = { divine: { entries: [e("a", 8, 0, { name: "Old" }), e("b", 2, 20, { name: "New" }), e("s", -1, 21, { name: "Spent", ref: "cast9" })] } };
  const life = lives({ divine: { span: 30, lifetime: { count: 1, unit: "month" }, cite: null, byHand: false } });
  const judge = model(raw, { lifetimes: life, today: 35, judge: true }).kinds[0];
  assert.deepEqual(judge.rows.map((r) => r.id), ["s", "b", "a"]);
  assert.deepEqual(judge.rows.map((r) => r.undoable), [true, false, false]);
  assert.deepEqual(judge.rows.map((r) => r.off), [false, false, true]);
  assert.equal(judge.rows[0].caption, "cast9");
  assert.equal(judge.rows[1].caption, 'fadesAfter{"span":"1 month"}');
  assert.equal(judge.rows[2].caption, "expired");
  assert.equal(judge.rows[0].tag, "−1");
  assert.equal(judge.rows[1].tag, "+2");
  assert.equal(model(raw, { lifetimes: life, today: 35, judge: false }).kinds[0].rows.some((r) => r.undoable), false);
  const used = model({ divine: { entries: [e("a", 3, 0), e("s", -3, 1)] } }, { lifetimes: life, today: 2 }).kinds[0].rows;
  assert.equal(used.find((r) => r.id === "a").caption, "usedUp");
  assert.equal(model({ divine: { entries: [e("h", 1, 0, { by: "judge" })] } }).kinds[0].rows[0].name, "byHand", "a figure set by hand is named so");
  assert.equal(model({ divine: { entries: [e("h", 1, 0)] } }).kinds[0].rows[0].name, "unnamed");
});

t("the arcane count's tooltip carries the page reference alone until a unit is imported", () => {
  const blank = model({}, { judge: true }).kinds[1].count;
  assert.equal(blank.tip, 'countTip{"cite":"cite.arcane"}');
  const unit = model({ arcane: { entries: [], count: 3 } }, { judge: true, lifetimes: lives({ arcane: { span: 90, lifetime: { count: 3, unit: "month" }, cite: "RR 7", byHand: false } }) }).kinds[1].count;
  assert.equal(unit.value, 3);
  assert.equal(unit.tip, 'countTipUnit{"unit":"month","cite":"cite.arcane"}');
});

/* ------------------------------ the live wrapper ------------------------------ */

const TABLES = { divineLifetime: { count: 2, unit: "week" }, arcaneLifetime: { unit: "month" } };
const register = (tables = TABLES) => registerTable({ id: "magicResearch", source: { pages: "Invented 1-2" }, cites: Object.fromEntries(Object.keys(tables).map((id) => [id, `Invented p. ${id.length}`])), tables }, { priority: PRIORITY.WORLD, source: "test" });

t("the calendar says each unit's days, and a unit it cannot say is null", () => {
  assert.deepEqual(L.calendarUnitDays(gameState.calendar), { day: 1, week: 7, month: 30, year: 360 });
  assert.deepEqual(L.calendarUnitDays({ days: { daysPerYear: 365 }, months: { values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } }), { day: 1, week: null, month: 31, year: 365 }, "a month is the year over its months, rounded up");
  assert.deepEqual(L.calendarUnitDays({}), { day: 1, week: null, month: null, year: null });
  assert.deepEqual(L.calendarUnitDays(undefined) && L.calendarUnitDays(null), { day: 1, week: null, month: null, year: null });
});

t("with no table imported nothing expires; the divine lifetime is the imported span and the arcane one needs the ledger's count", () => {
  resetTables();
  const led = P.readLedger({ arcane: { count: 2 } });
  const none = L.lifetimesFor(led);
  assert.deepEqual([none.divine.span, none.arcane.span, none.divine.lifetime, none.arcane.lifetime], [null, null, null, null]);
  register();
  const got = L.lifetimesFor(led);
  assert.equal(got.divine.span, 14, "two of the imported unit, by the calendar's own length of it");
  assert.equal(got.divine.cite, "Invented p. 14");
  assert.equal(got.arcane.span, 60, "the page's unit and the Judge's count");
  assert.equal(L.lifetimesFor(P.readLedger({})).arcane.span, null, "a blank count means no expiry");
  assert.deepEqual(L.lifetimesFor(P.readLedger({}), { calendar: {} }).divine.span, null, "a calendar that cannot say the unit, none");
  resetTables();
});

/** A world actor whose flag and rights this test controls. */
function worldActor(uuid, { canModify = true, flags = undefined } = {}) {
  const actor = {
    uuid,
    flags: flags ? { "acks-extras": { power: flags } } : {},
    updates: [],
    canUserModify: () => canModify,
    testUserPermission: (user) => actor.owners?.includes(user?.id) === true,
    async update(patch) {
      actor.updates.push(patch);
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.split(".");
        let at = actor;
        for (const part of parts.slice(0, -1)) at = at[part] ??= {};
        at[parts.at(-1)] = value;
      }
    },
  };
  gameState.actors.set(uuid, actor);
  return actor;
}

await ta("the API writes the flag as a Judge, caps the bucket's row by the balance, and settles a handed row", async () => {
  resetTables();
  gameState.isGM = true;
  const actor = worldActor("Actor.a1");
  assert.deepEqual(await L.powerApi.gain(actor, "divine", { amount: 6, name: "Sacrifice: bandit chief", ref: "c1" }), { ok: true, id: "id1", amount: 6, balance: 6 });
  assert.deepEqual(Object.keys(actor.updates[0]), ["flags.acks-extras.power.divine"], "one write, to the kind's own key");
  assert.equal(L.powerApi.balance(actor, "divine"), 6);
  assert.equal(L.powerApi.expiry(actor, "divine"), null, "nothing imported, nothing fades");
  const row = L.powerApi.row(actor, "divine", { amount: 50 });
  assert.deepEqual([row.uuid, row.qty, row.cap], ["power:divine", 6, 6]);
  assert.equal(L.powerApi.row(actor, "arcane"), null, "none held, no row");
  const settled = await L.powerApi.settle(actor, { uuid: "power:divine", kind: "power", qty: 4, action: "consume" }, { name: "Spent: ritual", ref: "c2" });
  assert.deepEqual([settled.ok, settled.amount, settled.balance], [true, 4, 2]);
  assert.deepEqual(await L.powerApi.settle(actor, { uuid: "Actor.x", qty: 1 }), { ok: false, reason: "kind" });
  register();
  assert.deepEqual(L.powerApi.expiry(actor, "divine"), { day: 19, amount: 2, inDays: 14 }, "the day stamp is the calendar day (5), plus the imported span");
  resetTables();
});

await ta("a Player who owns the actor writes it directly and is blocked past the balance; one who cannot write it is relayed", async () => {
  resetTables();
  gameState.isGM = false;
  const own = worldActor("Actor.p1", { canModify: true, flags: { divine: { entries: [e("a", 3, 5)] } } });
  assert.deepEqual(await L.powerApi.spend(own, "divine", { amount: 9 }), { ok: false, reason: "short" });
  assert.equal(own.updates.length, 0);
  assert.equal((await L.powerApi.spend(own, "divine", { amount: 2 })).ok, true);
  assert.equal(own.updates.length, 1);
  const away = worldActor("Actor.p2", { canModify: false });
  gameState.isGM = false;
  const sent = [];
  globalThis.game.socket = { emit: (channel, message) => sent.push(message) };
  const answer = await L.powerApi.gain(away, "divine", { amount: 1 });
  assert.deepEqual(answer, { ok: false, reason: "noGm" }, "a relay nobody answers is not a write");
  assert.deepEqual(sent.map((m) => [m.action, m.payload]), [[POWER_HANDLER, { actorUuid: "Actor.p2", kind: "divine", op: "gain", args: { amount: 1 } }]], "it was sent to the GM's client under the ledger's handler");
  assert.equal(away.updates.length, 0, "and nothing was written from this seat");
  delete globalThis.game.socket;
  gameState.isGM = true;
});

await ta("the relay handler authorizes on the sender it was told of, never on the payload", async () => {
  resetTables();
  gameState.isGM = true;
  const actor = worldActor("Actor.h1", { flags: { divine: { entries: [e("a", 3, 5), e("s", -1, 5)] } } });
  actor.owners = ["owner1"];
  gameState.users.set("owner1", { id: "owner1", isGM: false });
  gameState.users.set("other1", { id: "other1", isGM: false });
  const ask = (op, args, requestUserId, kind = "divine") => L.powerHandler({ actorUuid: "Actor.h1", kind, op, args, requestUserId });
  assert.deepEqual(await ask("gain", { amount: 1 }, "other1"), { ok: false, reason: "owner" }, "a user who is no owner");
  assert.deepEqual(await ask("undo", { id: "s" }, "owner1"), { ok: false, reason: "judge" }, "an owner asking for the Judge's undo");
  assert.deepEqual(await ask("count", { count: 2 }, "owner1", "arcane"), { ok: false, reason: "judge" });
  assert.deepEqual(await ask("gain", { amount: 1, by: "judge" }, "owner1"), { ok: false, reason: "judge" });
  assert.equal(actor.updates.length, 0, "every refusal wrote nothing");
  assert.equal((await ask("gain", { amount: 2, name: "x" }, "owner1")).ok, true);
  assert.deepEqual(await ask("spend", { amount: 99 }, "owner1"), { ok: false, reason: "short" }, "an owner's spend over the balance is blocked");
  assert.equal((await ask("undo", { id: "s" }, undefined)).ok, true, "the Judge's own client (no sender id) may");
  assert.deepEqual(await L.powerHandler({ actorUuid: "Actor.none", kind: "divine", op: "gain", args: {}, requestUserId: "owner1" }), { ok: false, reason: "noActor" });
  const { executeAsGM, registerHandler } = await import("../scripts/lib/sockets.mjs");
  L.registerPower();
  await new Promise((r) => setTimeout(r, 0));
  assert.throws(() => registerHandler(POWER_HANDLER, () => {}), /registered twice/, "registerPower registered the handler under its name");
  assert.equal((await executeAsGM(POWER_HANDLER, { actorUuid: "Actor.h1", kind: "divine", op: "gain", args: { amount: 1 } })).ok, true);
});

/* ------------------------------------ the chip ------------------------------------ */

t("the strip's ledger section: a Player sees entries and no control; a Judge sees both kinds, the controls and the count", () => {
  resetTables();
  const actor = worldActor("Actor.c1", { flags: { divine: { entries: [e("a", 4, 5, { name: "Sacrifice: <b>chief</b>", img: "icons/svg/skull.svg" }), e("s", -1, 5, { name: "Spent" })] } } });
  gameState.isGM = false;
  const player = C.powerSectionHtml(actor, true);
  assert.ok(player.includes('data-power="divine"') && !player.includes('data-power="arcane"'));
  assert.ok(!player.includes("data-power-adjust") && !player.includes("data-power-undo") && !player.includes("data-power-count"), "a Player's strip draws no button and no count");
  assert.ok(player.includes("&#60;b&#62;chief") && !player.includes("<b>chief"), "a source's name is escaped");
  assert.ok(player.includes('src="icons/svg/skull.svg"') && player.includes("fa-wand-sparkles"), "an entry leads with its source's picture, else a glyph");
  assert.ok(/<span class="acks-nums">3<\/span>/.test(player), "the balance is on the chip's face");
  gameState.isGM = true;
  const judge = C.powerSectionHtml(actor, true);
  assert.ok(judge.includes('data-power="arcane"'));
  assert.equal((judge.match(/data-power-adjust="1"/g) ?? []).length, 2, "a plus on each tag");
  assert.equal((judge.match(/data-power-adjust="-1"/g) ?? []).length, 2);
  assert.equal((judge.match(/data-power-undo=/g) ?? []).length, 1, "Undo on the one spend");
  assert.equal((judge.match(/data-power-count/g) ?? []).length, 1, "the count is arcane's alone");
  assert.ok(!/\sid=/.test(judge), "no literal id");
  const empty = worldActor("Actor.c2");
  assert.ok(C.powerSectionHtml(empty, true).includes(">ACKS-MAGIC.power.empty<"), "a Judge's casting strip on an empty ledger says so");
  assert.equal(C.powerSectionHtml(empty, false), "", "an actor that casts nothing and holds no power draws no ledger");
  assert.ok(C.powerSectionHtml(actor, false).includes('data-power="divine"'), "an actor with power and no pools still draws its chips");
  gameState.isGM = false;
  assert.equal(C.powerSectionHtml(empty, true), "", "a Player sees nothing of an empty ledger");
  gameState.isGM = true;
});

await ta("a Judge's plus, minus, Undo and count reach the ledger; a Player's strip is not wired to anything", async () => {
  resetTables();
  gameState.isGM = true;
  const actor = worldActor("Actor.c3", { flags: {} });
  const handlers = {};
  const strip = { addEventListener: (type, fn) => (handlers[type] = fn) };
  C.wirePowerChip(strip, actor);
  const press = (sel, dataset) => handlers.click({ target: { closest: (s) => (s === sel ? { dataset } : null) }, preventDefault() {} });
  press("[data-power-adjust]", { powerKind: "divine", powerAdjust: "1" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(L.powerApi.balance(actor, "divine"), 1);
  assert.equal(actor.flags["acks-extras"].power.divine.entries[0].by, "judge");
  press("[data-power-adjust]", { powerKind: "divine", powerAdjust: "-1" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(L.powerApi.balance(actor, "divine"), 0);
  const spendId = actor.flags["acks-extras"].power.divine.entries[1].id;
  press("[data-power-undo]", { powerKind: "divine", powerUndo: spendId });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(L.powerApi.balance(actor, "divine"), 1, "Undo gave the spend back");
  handlers.change({ target: { closest: (s) => (s === "[data-power-count]" ? { value: "4" } : null) } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(actor.flags["acks-extras"].power.arcane.count, 4);
  press("[data-power-adjust]", { powerKind: "arcane", powerAdjust: "-1" });
  await new Promise((r) => setTimeout(r, 0));
  assert.ok((gameState.warned ?? []).some((m) => m === "ACKS-MAGIC.power.warn.short"), "a minus on nothing held warns");
  gameState.isGM = false;
  press("[data-power-adjust]", { powerKind: "divine", powerAdjust: "1" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(L.powerApi.balance(actor, "divine"), 1, "a Player's press, were one sent, is refused");
  assert.ok(gameState.warned.includes("ACKS-MAGIC.power.refused.judge"));
  gameState.isGM = true;
});

/* ------------------------------ a hand plus that stays ------------------------------ */

t("a lot's stay mark survives a clean only on a gain, and a stored entry without one reads as it always did", () => {
  assert.deepEqual(P.cleanEntry({ id: "a", amount: 2, day: 1, stays: true }), { id: "a", amount: 2, day: 1, name: "", img: "", ref: "", by: "", stays: true });
  assert.equal("stays" in P.cleanEntry({ id: "a", amount: 2, day: 1 }), false, "no key where there was no mark");
  for (const bad of [false, "true", 1, null, "yes"]) assert.equal("stays" in P.cleanEntry({ id: "a", amount: 2, stays: bad }), false, String(bad));
  assert.equal("stays" in P.cleanEntry({ id: "s", amount: -2, stays: true }), false, "a spend never stays");
  assert.equal(P.readLedger({ divine: { entries: [{ id: "a", amount: 3, day: 1, stays: true }] } }).divine.entries[0].stays, true, "the mark is kept through a read of the flag");
  assert.equal(P.withEntry(P.readLedger(null), "divine", e("a", 3, 1, { stays: true })).divine.entries[0].stays, true, "and through an append");
});

t("a lot that stays never expires, counts in the balance past any span, and is never due to fade", () => {
  const entries = [e("k", 5, 0, { stays: true })];
  assert.equal(P.balanceOf(entries, 9999, 30), 5);
  assert.deepEqual(P.standing(entries, 9999, 30).map((l) => [l.stays, l.expired, l.expiresDay]), [[true, false, null]]);
  assert.equal(P.nextExpiry(entries, 5, 30), null, "only a lot that stays: nothing is due");
  const mixed = [e("k", 5, 0, { stays: true }), e("f", 2, 0)];
  assert.equal(P.balanceOf(mixed, 40, 30), 5, "the fading lot is gone and the staying one stands");
  assert.deepEqual(P.nextExpiry([...mixed, e("g", 1, 20)], 40, 30), { day: 50, amount: 1, inDays: 10 }, "the next to fade skips the lot that stays");
  assert.equal(P.standing([e("f", 2, 0)], 5, 30)[0].stays, false, "a lot with no mark fades");
});

t("a spend takes the fading lots first, oldest first, and the lots that stay only after them", () => {
  const left = (entries, today, span = 30) => Object.fromEntries(P.standing(entries, today, span).map((l) => [l.id, l.left]));
  const stayOld = e("k", 5, 0, { stays: true });
  assert.deepEqual(left([stayOld, e("f", 3, 10), e("s", -2, 12)], 13), { k: 5, f: 1 }, "plain oldest-first would have drawn on the older lot that stays");
  assert.deepEqual(left([stayOld, e("f", 3, 10), e("s", -4, 12)], 13), { k: 4, f: 0 }, "past the fading total the rest comes from the lot that stays");
  assert.deepEqual(left([e("f1", 2, 1), stayOld, e("f2", 2, 5), e("s", -3, 6)], 7), { f1: 0, k: 5, f2: 1 }, "two fading lots go oldest first before the one that stays");
  assert.deepEqual(left([e("k1", 2, 0, { stays: true }), e("k2", 3, 4, { stays: true }), e("s", -3, 6)], 7), { k1: 0, k2: 2 }, "lots that stay go oldest first among themselves");
  assert.deepEqual(left([stayOld, e("f", 3, 0), e("s", -2, 40)], 41), { k: 3, f: 3 }, "a fading lot that had expired by the spend's day was never drawn on, so the lot that stays pays");
  assert.deepEqual(left([stayOld, e("f", 3, 10), e("s", -2, 12)], 13, null), { k: 5, f: 1 }, "with no lifetime the mark still orders the draw");
  assert.equal(P.balanceOf([stayOld, e("f", 3, 10), e("s", -4, 12)], 100, 30), 4, "and what stays is what is left once the fading power has faded");
});

t("a Judge's chip carries the Fades / Stays labels and a Player's carries none", () => {
  const raw = { divine: { entries: [e("a", 4, 1, { name: "Sacrifice: bandit chief" })] } };
  const judge = model(raw, { judge: true });
  assert.deepEqual(judge.kinds.map((k) => k.stay), [
    { group: 'stayGroup{"label":"kind.divine"}', fades: "fades", stays: "stays", fadesTip: "fadesTip", staysTip: "staysTip" },
    { group: 'stayGroup{"label":"kind.arcane"}', fades: "fades", stays: "stays", fadesTip: "fadesTip", staysTip: "staysTip" },
  ]);
  assert.deepEqual(model(raw).kinds.map((k) => k.stay), [null, null]);
});

t("a lot that stays is a row with a pin and its own caption, and the tooltip says so for that entry", () => {
  const raw = { divine: { entries: [e("k", 6, 0, { by: "judge", stays: true }), e("f", 2, 1, { by: "judge" }), e("p", 2, 2, { by: "judge", stays: true }), e("s", -2, 3, { by: "judge" })] } };
  const life = lives({ divine: { span: 30, lifetime: { count: 1, unit: "month" }, cite: null, byHand: false } });
  const k = model(raw, { lifetimes: life, today: 500, judge: true }).kinds[0];
  const row = (id) => k.rows.find((r) => r.id === id);
  assert.deepEqual([row("k").caption, row("k").pinned, row("k").stays, row("k").glyph, row("k").off], ["staysCaption", true, true, "fa-thumbtack", false], "far past the lifetime it is neither dimmed nor expired");
  assert.deepEqual([row("f").caption, row("f").pinned, row("f").stays, row("f").off], ["expired", false, false, true]);
  assert.equal(row("k").tip.startsWith("entryTipStays"), true);
  assert.equal(row("f").tip.startsWith("entryTip{"), true);
  assert.equal(k.balance, 8, "the eight that stay stand; the fading lot went to the spend, which drew on it before them");
  const small = model({ divine: { entries: [e("k", 3, 0, { by: "judge", stays: true })] } }, { lifetimes: life, today: 4 }).kinds[0];
  assert.ok(small.tip.includes("byHand +3 (tipStays)"), small.tip);
  assert.ok(!model({ divine: { entries: [e("f", 3, 0, { by: "judge" })] } }, { lifetimes: life, today: 4 }).kinds[0].tip.includes("tipStays"), "a lot that fades is not marked");
  const used = model({ divine: { entries: [e("k", 3, 0, { stays: true }), e("s", -3, 1)] } }, { lifetimes: life, today: 2 }).kinds[0].rows.find((r) => r.id === "k");
  assert.deepEqual([used.caption, used.pinned], ["usedUp", false], "a lot that stays and is spent to nothing is used up, with no pin");
});

await ta("a Judge's gain that stays is written as a lot that keeps through any lifetime; a gain that fades is not", async () => {
  const r = rig({ span: 10 });
  const kept = await r.ops.gain(r.actor, "divine", { amount: 3, name: "x", by: "judge", stays: true });
  assert.deepEqual(kept, { ok: true, id: "e1", amount: 3, balance: 3 });
  assert.equal(r.flag.divine.entries[0].stays, true);
  await r.ops.gain(r.actor, "divine", { amount: 2, by: "judge" });
  assert.equal("stays" in r.flag.divine.entries[1], false, "no key on a gain that fades");
  assert.equal(r.ops.balance(r.actor, "divine"), 5);
  r.today = 100 + 9;
  assert.equal(r.ops.balance(r.actor, "divine"), 5);
  r.today = 100 + 10;
  assert.equal(r.ops.balance(r.actor, "divine"), 3, "the fading point lapsed at the lifetime");
  r.today = 100 + 4000;
  assert.equal(r.ops.balance(r.actor, "divine"), 3, "the point that stays is still there");
  const spent = await r.ops.spend(r.actor, "divine", { amount: 2, by: "judge" });
  assert.deepEqual([spent.ok, spent.amount, spent.balance], [true, 2, 1]);
  assert.equal("stays" in r.flag.divine.entries.at(-1), false, "a spend is never a lot that stays");
  assert.equal((await r.ops.gain(r.actor, "arcane", { amount: 1, stays: true })).ok, true, "a Judge's stay needs no hand mark and holds with no lifetime for arcane");
  assert.equal(r.flag.arcane.entries[0].stays, true);
});

await ta("a spend, an API settle too, draws the fading lots first and leaves what stays", async () => {
  const r = rig({ span: 50 });
  await r.ops.gain(r.actor, "divine", { amount: 4, name: "kept", by: "judge", stays: true });
  r.today = 101;
  await r.ops.gain(r.actor, "divine", { amount: 3, name: "faded" });
  await r.ops.spend(r.actor, "divine", { amount: 2 });
  const lots = P.standing(P.readLedger(r.flag).divine.entries, r.today, 50);
  assert.deepEqual(lots.map((l) => [l.name, l.left]), [["kept", 4], ["faded", 1]]);
  assert.equal(r.ops.balance(r.actor, "divine"), 5);
});

await ta("a Player's request for a lot that stays is refused, direct or relayed, and nothing is written", async () => {
  const own = rig({ judge: false, canWrite: true });
  assert.deepEqual(await own.ops.gain(own.actor, "divine", { amount: 1, stays: true }), { ok: false, reason: "judge" });
  assert.equal(own.writes, 0);
  const away = rig({ judge: false, canWrite: false });
  assert.deepEqual(await away.ops.gain(away.actor, "divine", { amount: 1, stays: true }), { ok: false, reason: "judge" });
  assert.deepEqual([away.relays.length, away.writes], [0, 0], "refused before a request is sent");
  assert.deepEqual(P.checkPowerRequest({ kind: "divine", op: "gain", args: { stays: true } }, { actor: {}, fromJudge: false, owns: true }), { refused: "judge" });
  assert.deepEqual(P.checkPowerRequest({ kind: "divine", op: "gain", args: { stays: true } }, { actor: {}, fromJudge: true, owns: false }), { ok: true });
  assert.deepEqual(P.checkPowerRequest({ kind: "divine", op: "gain", args: { stays: false } }, { actor: {}, fromJudge: false, owns: true }), { ok: true }, "only a request for the mark is the Judge's");
  const judgeRun = rig({ judge: true });
  await judgeRun.ops.apply(judgeRun.actor, "divine", "gain", { amount: 2, stays: true }, false);
  assert.equal("stays" in judgeRun.flag.divine.entries[0], false, "applied for a sender who is no Judge, the mark is not kept");
  await judgeRun.ops.apply(judgeRun.actor, "divine", "gain", { amount: 2, stays: true }, true);
  assert.equal(judgeRun.flag.divine.entries[1].stays, true);
});

await ta("the relay handler refuses an owner's request for a lot that stays and runs a Judge's", async () => {
  resetTables();
  gameState.isGM = true;
  const actor = worldActor("Actor.h2", { flags: {} });
  actor.owners = ["owner2"];
  gameState.users.set("owner2", { id: "owner2", isGM: false });
  const ask = (args, requestUserId) => L.powerHandler({ actorUuid: "Actor.h2", kind: "divine", op: "gain", args, requestUserId });
  assert.deepEqual(await ask({ amount: 1, stays: true }, "owner2"), { ok: false, reason: "judge" });
  assert.equal(actor.updates.length, 0);
  assert.equal((await ask({ amount: 1, name: "x" }, "owner2")).ok, true, "an owner's plain gain still runs");
  assert.equal((await ask({ amount: 2, stays: true }, undefined)).ok, true, "the Judge's own client may");
  assert.equal(actor.flags["acks-extras"].power.divine.entries.at(-1).stays, true);
  assert.equal("stays" in actor.flags["acks-extras"].power.divine.entries[0], false);
});

t("the strip draws a Fades / Stays pair for a Judge on each tag, Fades pressed, and none for a Player; a lot that stays shows its pin", () => {
  resetTables();
  const actor = worldActor("Actor.c4", { flags: { divine: { entries: [e("k", 4, 5, { name: "Kept", by: "judge", stays: true }), e("f", 2, 5, { name: "Faded", by: "judge" })] } } });
  gameState.isGM = false;
  const player = C.powerSectionHtml(actor, true);
  assert.ok(!player.includes("data-power-stay") && !player.includes("powerpill") && !player.includes('role="group"'), "a Player's strip draws no switch");
  assert.ok(player.includes('class="acks-extras-classes-powerline"><i class="fa-solid fa-thumbtack" inert></i> ACKS-MAGIC.power.staysCaption'), "but its rows show the lot that stays, a pin before its caption");
  assert.equal(player.split('powerline"><i class="fa-solid fa-thumbtack"').length - 1, 1, "and the lot that fades has none");
  gameState.isGM = true;
  const judge = C.powerSectionHtml(actor, true);
  assert.equal((judge.match(/role="group"/g) ?? []).length, 2, "a group on each tag");
  assert.equal((judge.match(/data-power-stay="0" data-power-kind="(divine|arcane)" aria-pressed="true"/g) ?? []).length, 2, "Fades starts pressed");
  assert.equal((judge.match(/data-power-stay="1" data-power-kind="(divine|arcane)" aria-pressed="false"/g) ?? []).length, 2, "Stays starts not pressed");
  assert.equal((judge.match(/aria-label="ACKS-MAGIC.power.stayGroup\{&#34;label&#34;:&#34;ACKS-MAGIC.power.kind.(divine|arcane)&#34;\}"/g) ?? []).length, 2, "each group is named for its power");
  assert.ok(/data-power="divine"[\s\S]*?data-power-adjust="1"[\s\S]*?data-power-adjust="-1"[\s\S]*?role="group"/.test(judge), "the switch follows the plus and minus it belongs to");
  assert.ok(!/\sid=/.test(judge), "no literal id");
});

await ta("the switch sets what that tag's plus writes, starts on Fades, and writes nothing itself", async () => {
  resetTables();
  gameState.isGM = true;
  const actor = worldActor("Actor.c5", { flags: {} });
  const handlers = {};
  const strip = { addEventListener: (type, fn) => (handlers[type] = fn) };
  C.wirePowerChip(strip, actor);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const pills = (kind) => {
    const list = ["0", "1"].map((v) => ({ dataset: { powerStay: v, powerKind: kind }, pressed: v === "0", setAttribute(name, value) { if (name === "aria-pressed") this.pressed = value === "true"; } }));
    for (const pill of list) pill.parentElement = { querySelectorAll: () => list };
    return list;
  };
  const divine = pills("divine");
  const pressPill = (pill) => handlers.click({ target: { closest: (s) => (s === "[data-power-stay]" ? pill : null) }, preventDefault() {} });
  const plus = (kind) => handlers.click({ target: { closest: (s) => (s === "[data-power-adjust]" ? { dataset: { powerKind: kind, powerAdjust: "1" } } : null) }, preventDefault() {} });
  const minus = (kind) => handlers.click({ target: { closest: (s) => (s === "[data-power-adjust]" ? { dataset: { powerKind: kind, powerAdjust: "-1" } } : null) }, preventDefault() {} });
  const entries = (kind) => actor.flags["acks-extras"].power?.[kind]?.entries ?? [];
  plus("divine");
  await tick();
  assert.equal("stays" in entries("divine")[0], false, "an untouched switch is Fades");
  const writes = actor.updates.length;
  pressPill(divine[1]);
  await tick();
  assert.equal(actor.updates.length, writes, "pressing the switch writes nothing");
  assert.deepEqual(divine.map((p) => p.pressed), [false, true], "the pressed state moves to the pill");
  plus("divine");
  await tick();
  assert.equal(entries("divine")[1].stays, true, "Stays then plus writes a lot that stays");
  plus("arcane");
  await tick();
  assert.equal("stays" in entries("arcane")[0], false, "the other tag's switch is its own, still Fades");
  pressPill(divine[0]);
  assert.deepEqual(divine.map((p) => p.pressed), [true, false]);
  minus("divine");
  await tick();
  assert.equal(entries("divine")[2].amount, -1);
  assert.equal("stays" in entries("divine")[2], false, "a minus never carries the gain's mark");
  assert.equal("fromStays" in entries("divine")[2], false, "on Fades the minus is the ordinary spend");
  assert.equal(L.powerApi.balance(actor, "divine"), 1, "the minus drew the fading point, so the point that stays is what is left");
  assert.equal(P.standing(entries("divine"), 5, null).find((l) => l.stays).left, 1);
  plus("divine");
  await tick();
  assert.equal("stays" in entries("divine")[3], false, "Fades then plus fades again");
  const fresh = {};
  C.wirePowerChip({ addEventListener: (type, fn) => (fresh[type] = fn) }, actor);
  fresh.click({ target: { closest: (s) => (s === "[data-power-adjust]" ? { dataset: { powerKind: "divine", powerAdjust: "1" } } : null) }, preventDefault() {} });
  await tick();
  assert.equal("stays" in entries("divine")[4], false, "a strip wired with no window's record starts on Fades");
  gameState.isGM = false;
  pressPill(divine[1]);
  plus("divine");
  await tick();
  assert.equal(entries("divine").length, 5, "a Player's stay press, were one sent, writes nothing");
  assert.ok(gameState.warned.filter((m) => m === "ACKS-MAGIC.power.refused.judge").length >= 1);
  gameState.isGM = true;
});

/* ------------------------------ a minus that removes a point that stays ------------------------------ */

t("a spend's from-stays mark survives a clean only on a spend, and a stored spend without one reads as it always did", () => {
  assert.deepEqual(P.cleanEntry({ id: "s", amount: -1, day: 1, fromStays: true }), { id: "s", amount: -1, day: 1, name: "", img: "", ref: "", by: "", fromStays: true });
  assert.equal("fromStays" in P.cleanEntry({ id: "s", amount: -1, day: 1 }), false, "no key where there was no mark");
  for (const bad of [false, "true", 1, null]) assert.equal("fromStays" in P.cleanEntry({ id: "s", amount: -1, fromStays: bad }), false, String(bad));
  assert.equal("fromStays" in P.cleanEntry({ id: "g", amount: 2, fromStays: true }), false, "a gain is never a removal");
  assert.equal(P.readLedger({ divine: { entries: [{ id: "s", amount: -1, fromStays: true }] } }).divine.entries[0].fromStays, true, "kept through a read of the flag");
  assert.equal(P.withEntry(P.readLedger(null), "divine", e("s", -1, 1, { fromStays: true })).divine.entries[0].fromStays, true, "and through an append");
});

t("a spend from the lots that stay draws only on them, oldest first, and leaves every fading lot", () => {
  const left = (entries, today, span = 30) => Object.fromEntries(P.standing(entries, today, span).map((l) => [l.id, l.left]));
  const keep1 = e("k1", 2, 0, { stays: true });
  const keep2 = e("k2", 3, 4, { stays: true });
  assert.deepEqual(left([e("f", 4, 1), keep1, keep2, e("s", -1, 6, { fromStays: true })], 7), { f: 4, k1: 1, k2: 3 }, "the oldest lot that stays pays, not the fading lot an ordinary spend takes first");
  assert.deepEqual(left([e("f", 4, 1), keep1, keep2, e("s", -3, 6, { fromStays: true })], 7), { f: 4, k1: 0, k2: 2 }, "it runs on to the next lot that stays");
  assert.deepEqual(left([e("f", 4, 1), keep1, e("s", -3, 6, { fromStays: true })], 7), { f: 4, k1: 0 }, "and stops at them: it never reaches into a fading lot");
  assert.deepEqual(left([e("f", 4, 1), keep1, e("s", -1, 6)], 7), { f: 3, k1: 2 }, "an ordinary spend is as before");
  assert.equal(P.stayingBalanceOf([e("f", 4, 1), keep1, keep2, e("s", -5, 6)], 7, 30), 4, "the ordinary spend drew the fading four first and then one that stays");
  assert.equal(P.stayingBalanceOf([e("f", 4, 1), keep1, keep2], 9999, 30), 5, "lots that stay count past any span");
  assert.equal(P.stayingBalanceOf([e("f", 4, 1)], 7, 30), 0);
});

await ta("a Judge's minus on Stays takes the oldest point that stays and leaves the fading ones; an Undo gives it back", async () => {
  const r = rig({ span: 50 });
  await r.ops.gain(r.actor, "divine", { amount: 2, name: "kept1", by: "judge", stays: true });
  r.today = 101;
  await r.ops.gain(r.actor, "divine", { amount: 3, name: "faded", by: "judge" });
  await r.ops.gain(r.actor, "divine", { amount: 4, name: "kept2", by: "judge", stays: true });
  const done = await r.ops.spend(r.actor, "divine", { amount: 1, by: "judge", fromStays: true });
  assert.deepEqual([done.ok, done.amount, done.balance, done.warn], [true, 1, 8, undefined]);
  const entry = r.flag.divine.entries.at(-1);
  assert.deepEqual([entry.amount, entry.by, entry.fromStays, "stays" in entry], [-1, "judge", true, false]);
  const lots = (ledger = r.flag) => Object.fromEntries(P.standing(P.readLedger(ledger).divine.entries, r.today, 50).map((l) => [l.name, l.left]));
  assert.deepEqual(lots(), { kept1: 1, faded: 3, kept2: 4 });
  assert.deepEqual(await r.ops.undo(r.actor, "divine", done.id), { ok: true, balance: 9 });
  assert.deepEqual(lots(), { kept1: 2, faded: 3, kept2: 4 }, "Undo took the removal back like any hand spend");
  await r.ops.spend(r.actor, "divine", { amount: 3, by: "judge", fromStays: true });
  assert.deepEqual(lots(), { kept1: 0, faded: 3, kept2: 3 }, "a removal runs on to the next lot that stays");
  const plain = await r.ops.spend(r.actor, "divine", { amount: 1, by: "judge" });
  assert.equal("fromStays" in r.flag.divine.entries.at(-1), false, "the ordinary spend carries no mark");
  assert.deepEqual(lots(), { kept1: 0, faded: 2, kept2: 3 }, "and still takes the fading lot first");
  assert.equal(plain.ok, true);
});

await ta("a Judge's minus on Stays with no point that stays writes nothing and warns, even where fading power is held", async () => {
  const r = rig({ span: 50 });
  await r.ops.gain(r.actor, "divine", { amount: 3, name: "faded", by: "judge" });
  const writes = r.writes;
  const none = await r.ops.spend(r.actor, "divine", { amount: 1, by: "judge", fromStays: true });
  assert.deepEqual([none.ok, none.amount, none.warn, none.balance], [true, 0, "staysShort", 3], "the balance is what is held, not zero");
  assert.equal(r.writes, writes);
  await r.ops.gain(r.actor, "divine", { amount: 1, by: "judge", stays: true });
  const some = await r.ops.spend(r.actor, "divine", { amount: 5, by: "judge", fromStays: true });
  assert.deepEqual([some.ok, some.amount, some.warn, some.balance], [true, 1, "staysShort", 3], "short of the lots that stay it takes what they hold and leaves the fading power");
  const empty = rig();
  assert.deepEqual([(await empty.ops.spend(empty.actor, "arcane", { amount: 1, fromStays: true })).warn, empty.writes], ["staysShort", 0]);
});

await ta("a Player can never draw from the lots that stay alone: refused direct, unsent, relayed and applied, and nothing is written", async () => {
  const own = rig({ judge: false, canWrite: true });
  own.flag = { divine: { entries: [e("k", 3, 90, { stays: true })] } };
  assert.deepEqual(await own.ops.spend(own.actor, "divine", { amount: 1, fromStays: true }), { ok: false, reason: "judge" });
  const away = rig({ judge: false, canWrite: false });
  assert.deepEqual(await away.ops.spend(away.actor, "divine", { amount: 1, fromStays: true }), { ok: false, reason: "judge" });
  assert.deepEqual([own.writes, away.relays.length, away.writes], [0, 0, 0], "refused before a request is sent");
  const ask = (args, who) => P.checkPowerRequest({ kind: "divine", op: "spend", args }, { actor: {}, ...who });
  assert.deepEqual(ask({ amount: 1, fromStays: true }, { fromJudge: false, owns: true }), { refused: "judge" });
  assert.deepEqual(ask({ amount: 1, fromStays: true }, { fromJudge: true, owns: false }), { ok: true });
  assert.deepEqual(ask({ amount: 1, fromStays: false }, { fromJudge: false, owns: true }), { ok: true }, "only a request for the mark is the Judge's");
  const gm = rig({ judge: true });
  gm.flag = { divine: { entries: [e("k", 3, 90, { stays: true }), e("f", 3, 90)] } };
  assert.deepEqual(await gm.ops.apply(gm.actor, "divine", "spend", { amount: 1, fromStays: true }, false), { ok: false, reason: "judge" }, "applied for a sender who is no Judge it is refused, not run as an ordinary spend");
  assert.equal(gm.writes, 0);
  assert.equal((await gm.ops.apply(gm.actor, "divine", "spend", { amount: 1, fromStays: true }, true)).ok, true);
  assert.equal(gm.flag.divine.entries.at(-1).fromStays, true);
});

await ta("the relay handler refuses an owner's removal from the lots that stay and runs a Judge's", async () => {
  resetTables();
  gameState.isGM = true;
  const actor = worldActor("Actor.h3", { flags: { divine: { entries: [e("k", 3, 5, { stays: true }), e("f", 3, 5)] } } });
  actor.owners = ["owner3"];
  gameState.users.set("owner3", { id: "owner3", isGM: false });
  const ask = (args, requestUserId) => L.powerHandler({ actorUuid: "Actor.h3", kind: "divine", op: "spend", args, requestUserId });
  assert.deepEqual(await ask({ amount: 1, fromStays: true }, "owner3"), { ok: false, reason: "judge" });
  assert.equal(actor.updates.length, 0);
  assert.equal((await ask({ amount: 1 }, "owner3")).ok, true, "an owner's ordinary spend still runs");
  assert.equal((await ask({ amount: 1, fromStays: true }, undefined)).ok, true, "the Judge's own client may");
  assert.equal(actor.flags["acks-extras"].power.divine.entries.at(-1).fromStays, true);
  assert.equal("fromStays" in actor.flags["acks-extras"].power.divine.entries[2], false);
});

t("a removal from the lots that stay captions itself, and the chip carries the minus's second label", () => {
  const raw = { divine: { entries: [e("k", 3, 0, { by: "judge", stays: true }), e("s", -1, 1, { by: "judge", fromStays: true }), e("t", -1, 2, { by: "judge" })] } };
  const k = model(raw, { judge: true }).kinds[0];
  const row = (id) => k.rows.find((r) => r.id === id);
  assert.deepEqual([row("s").caption, row("s").fromStays, row("s").stays], ["removedStays", true, false]);
  assert.deepEqual([row("t").caption, row("t").fromStays], ["", false]);
  assert.equal(k.removeStaysLabel, 'removeStaysLabel{"label":"kind.divine"}');
  assert.equal(k.balance, 1);
});

/** A strip whose pills and minus buttons are objects, wired over a window's own record. */
function wiredStrip(actor, state) {
  const handlers = {};
  const buttons = Object.fromEntries(["divine", "arcane"].map((kind) => [kind, { dataset: { powerLabel: `remove ${kind}`, powerLabelStays: `remove staying ${kind}` }, label: `remove ${kind}`, setAttribute(name, value) { if (name === "aria-label") this.label = value; } }]));
  const strip = { addEventListener: (type, fn) => (handlers[type] = fn), querySelector: (sel) => buttons[/data-power-kind="(\w+)"/.exec(sel)?.[1]] ?? null };
  C.wirePowerChip(strip, actor, state);
  const pills = Object.fromEntries(["divine", "arcane"].map((kind) => {
    const list = ["0", "1"].map((v) => ({ dataset: { powerStay: v, powerKind: kind }, pressed: v === "0", setAttribute(name, value) { if (name === "aria-pressed") this.pressed = value === "true"; } }));
    for (const pill of list) pill.parentElement = { querySelectorAll: () => list };
    return [kind, list];
  }));
  const click = (hit) => handlers.click({ target: { closest: (s) => hit(s) }, preventDefault() {} });
  return {
    buttons,
    pills,
    press: (kind, v) => click((s) => (s === "[data-power-stay]" ? pills[kind][v] : null)),
    plus: (kind) => click((s) => (s === "[data-power-adjust]" ? { dataset: { powerKind: kind, powerAdjust: "1" } } : null)),
    take: (kind) => click((s) => (s === "[data-power-adjust]" ? { dataset: { powerKind: kind, powerAdjust: "-1" } } : null)),
  };
}

await ta("the switch holds across a render: kept per window and per tag, never on the actor, and Fades for a window that has not set it", async () => {
  resetTables();
  gameState.isGM = true;
  const actor = worldActor("Actor.c6", { flags: {} });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const entries = (kind) => actor.flags["acks-extras"].power?.[kind]?.entries ?? [];
  const windowA = {};
  const windowB = {};
  assert.deepEqual(C.powerSwitchOf(windowA), { divine: false, arcane: false }, "a window that has not set it reads Fades");
  assert.equal(C.powerSwitchOf(windowA), C.powerSwitchOf(windowA), "one record per window");
  assert.notEqual(C.powerSwitchOf(windowA), C.powerSwitchOf(windowB), "two windows, two records");
  assert.notEqual(C.powerSwitchOf(null), C.powerSwitchOf(null), "no window, nothing kept");
  const render1 = wiredStrip(actor, C.powerSwitchOf(windowA));
  render1.press("divine", 1);
  assert.equal(render1.buttons.divine.label, "remove staying divine", "the divine minus is relabelled");
  assert.equal(render1.buttons.arcane.label, "remove arcane", "and the arcane one is not");
  const writes = actor.updates.length;
  assert.equal(writes, 0, "a pill press writes nothing to the actor");
  render1.plus("divine");
  await tick();
  const render2 = wiredStrip(actor, C.powerSwitchOf(windowA));
  render2.plus("divine");
  await tick();
  assert.deepEqual(entries("divine").map((x) => x.stays === true), [true, true], "after a render the next plus still stays");
  assert.deepEqual(actor.updates.map((u) => Object.keys(u)[0]), ["flags.acks-extras.power.divine", "flags.acks-extras.power.divine"], "only the two gains were written");
  render2.plus("arcane");
  await tick();
  assert.equal("stays" in entries("arcane")[0], false, "the arcane tag was never set, so it fades");
  const other = wiredStrip(actor, C.powerSwitchOf(windowB));
  other.plus("divine");
  await tick();
  assert.equal("stays" in entries("divine")[2], false, "a second window on the same actor opens on Fades");
  const html = (win) => C.powerSectionHtml(actor, true, C.powerSwitchOf(win));
  const a = html(windowA);
  assert.ok(/data-power-stay="1" data-power-kind="divine" aria-pressed="true"/.test(a) && /data-power-stay="0" data-power-kind="divine" aria-pressed="false"/.test(a), "the render draws the divine pair as set");
  assert.ok(/data-power-stay="0" data-power-kind="arcane" aria-pressed="true"/.test(a), "and the arcane pair on Fades");
  assert.ok(/data-power-kind="divine" data-power-label="[^"]*" data-power-label-stays="[^"]*" aria-label="[^"]*removeStaysLabel/.test(a), "the divine minus is drawn with its second label");
  assert.ok(/data-power-kind="arcane" data-power-label="[^"]*" data-power-label-stays="[^"]*" aria-label="[^"]*removeLabel/.test(a), "the arcane one with its first");
  const b = html(windowB);
  assert.ok(/data-power-stay="0" data-power-kind="divine" aria-pressed="true"/.test(b), "the other window's pair is on Fades");
  render2.press("divine", 0);
  assert.deepEqual(C.powerSwitchOf(windowA), { divine: false, arcane: false }, "pressing Fades puts it back");
  render2.press("divine", 1);
  render2.press("arcane", 1);
  assert.deepEqual(C.powerSwitchOf(windowA), { divine: true, arcane: true }, "each tag holds its own state");
  C.forgetPowerSwitch(windowB);
  assert.deepEqual(C.powerSwitchOf(windowA), { divine: true, arcane: true }, "closing another window leaves this one's record");
  C.forgetPowerSwitch(windowA);
  assert.deepEqual(C.powerSwitchOf(windowA), { divine: false, arcane: false }, "a window closed and opened again reads Fades");
  C.forgetPowerSwitch(null);
  C.forgetPowerSwitch("not a window");
  assert.equal(actor.updates.length, 4, "still only the four gains were written");
  const bareA = wiredStrip(actor);
  const bareB = wiredStrip(actor);
  bareA.press("divine", 1);
  bareB.plus("divine");
  await tick();
  assert.equal("stays" in entries("divine").at(-1), false, "two strips wired with no window's record share nothing");
});

await ta("the minus on a tag set to Stays removes a point that stays, and on Fades spends as it did; the switch is read at each press", async () => {
  resetTables();
  gameState.isGM = true;
  gameState.warned = [];
  const actor = worldActor("Actor.c7", { flags: {} });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const entries = () => actor.flags["acks-extras"].power.divine.entries;
  const window = {};
  const strip = wiredStrip(actor, C.powerSwitchOf(window));
  strip.plus("divine");
  strip.press("divine", 1);
  strip.plus("divine");
  strip.plus("divine");
  await tick();
  assert.deepEqual(entries().map((x) => x.stays === true), [false, true, true]);
  const strip2 = wiredStrip(actor, C.powerSwitchOf(window));
  strip2.take("divine");
  await tick();
  assert.deepEqual([entries()[3].amount, entries()[3].fromStays, entries()[3].by], [-1, true, "judge"], "on Stays the minus is a removal from the lots that stay");
  const lots = () => Object.fromEntries(P.standing(entries(), 5, null).map((l) => [l.id, l.left]));
  assert.deepEqual(Object.values(lots()), [1, 0, 1], "the oldest point that stays went and the fading one is untouched");
  strip2.press("divine", 0);
  strip2.take("divine");
  await tick();
  assert.equal("fromStays" in entries()[4], false, "on Fades the minus is the ordinary spend");
  assert.deepEqual(Object.values(lots()), [0, 0, 1], "which took the fading point first");
  strip2.press("divine", 1);
  strip2.take("divine");
  await tick();
  strip2.take("divine");
  await tick();
  assert.equal(entries().length, 6, "with no point that stays left, a second removal writes nothing");
  assert.ok(gameState.warned.includes("ACKS-MAGIC.power.warn.staysShort"), "and warns the Judge");
  gameState.isGM = false;
  strip2.take("divine");
  await tick();
  assert.equal(entries().length, 6, "a Player's removal, were one sent, writes nothing");
  assert.ok(gameState.warned.includes("ACKS-MAGIC.power.refused.judge"));
  gameState.isGM = true;
});

console.log(`\n${n} power-ledger tests passed`);
