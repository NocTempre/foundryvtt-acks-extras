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

console.log(`\n${n} power-ledger tests passed`);
