/**
 * Offline tests for concentration's end (`scripts/magic/cast-held.mjs`): the
 * cause of an end, what the end does to each recipient record by the tail, the
 * relay's check, the funnel with its card, Restore's plan and the card's body.
 * Foundry-free; every spell, actor and figure below is invented, so this file
 * carries no book content.
 *
 * Usage: node tools/test-cast-held.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };

const { heldStatusOf, heldRecordData, causeOf, heldEndPlan, checkHeldEndRequest, restorePlan, runHeldPlan, endHeldCast, heldEndContent, bindCard, HELD_CAUSES } = await import("../scripts/magic/cast-held.mjs");
const { spellEffectData, spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");

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

const rec = (id, over = {}) => ({ id, actorUuid: `Actor.${id}`, name: `Actor ${id}`, startTime: 100, duration: { value: 1, units: "hours" }, ...over });
const TAIL = { value: 2, units: "rounds" };

t("the status a held record carries follows the kind held", () => {
  assert.equal(heldStatusOf("stationary"), "concentratingStationary");
  assert.equal(heldStatusOf("mobile"), "concentrating");
  assert.equal(heldStatusOf(undefined), "concentrating");
});

const MARK = { spell: { uuid: "Actor.c1.Item.s1", name: "Invented Hold", img: "icons/invented.webp" }, caster: { uuid: "Actor.c1" }, castId: "cast0001", role: "caster" };

t("a held record is the caster's status-only record: the status for its kind, the kind, the tail, the clock started now and the cap as its flag-timed duration", () => {
  const cap = { value: 12, units: "rounds" };
  const tail = { value: 2, units: "rounds" };
  const data = heldRecordData(MARK, { held: "stationary", now: 40, tail, cap });
  assert.deepEqual(data, spellEffectData({ ...MARK, startTime: 40, statuses: ["concentratingStationary"], held: "stationary", tail, duration: cap }));
  assert.deepEqual(data.statuses, ["concentratingStationary"]);
  assert.equal(data.changes.length, 0);
  const back = spellEffectOf(data);
  assert.deepEqual([back.role, back.held, back.tail, back.duration, back.startTime], ["caster", "stationary", tail, cap, 40]);
  const bare = spellEffectOf(heldRecordData(MARK, { held: "mobile", now: 7 }));
  assert.deepEqual([bare.held, bare.tail, bare.duration, bare.startTime], ["mobile", undefined, undefined, 7], "no tail and no cap leave neither");
  assert.equal(heldRecordData({ ...MARK, invocationLevel: 3 }, { held: "mobile", now: 7 }).flags["acks-extras"].spellEffect.invocationLevel, 3, "the mark's own keys ride along");
});

t("the cause: the cast's own delete names it, else the loss lib is lifting, else removed", () => {
  assert.equal(causeOf({ "acks-extras": { endCause: "cast" } }, null), "cast");
  assert.equal(causeOf({ "acks-extras": { endCause: "time" } }, { cause: "damage" }), "time", "the named cause wins");
  assert.equal(causeOf({}, { cause: "damage" }), "damage");
  assert.equal(causeOf(undefined, { cause: "save" }), "save");
  assert.equal(causeOf({}, { cause: "moved" }), "removed", "a loss that is not a concentration's is not read");
  assert.equal(causeOf({ "acks-extras": { endCause: "damage" } }, null), "removed", "a seat cannot name a loss in the options");
  assert.equal(causeOf({}, null), "removed");
  assert.equal(causeOf({ "acks-extras": { endCause: "saved" } }, { cause: "damage" }), "saved", "a recurring prompt's passed save names its own cause");
  assert.ok(HELD_CAUSES.every((c) => ["damage", "save", "cast", "time", "removed", "saved"].includes(c)));
  assert.ok(HELD_CAUSES.includes("saved"));
});

t("with no tail every recipient the client can write is removed; a tail re-times it from now and keeps the earlier figures; a none tail leaves it open; what it cannot write is relayed", () => {
  const recipients = [rec("a"), rec("b"), rec("c", { startTime: undefined, duration: undefined })];
  const canWrite = (r) => r.id !== "b";
  const gone = heldEndPlan({ tail: undefined, recipients, canWrite, now: 500 });
  assert.deepEqual(gone.remove.map((r) => r.id), ["a", "c"]);
  assert.deepEqual(gone.relay.map((r) => r.id), ["b"]);
  assert.deepEqual([gone.retime.length, gone.open.length], [0, 0]);
  const ran = heldEndPlan({ tail: TAIL, recipients, canWrite, now: 500 });
  assert.deepEqual(ran.retime.map((r) => [r.id, r.startTime, r.duration]), [["a", 500, TAIL], ["c", 500, TAIL]]);
  assert.deepEqual(ran.retime[0].was, { startTime: 100, duration: { value: 1, units: "hours" } });
  assert.deepEqual(ran.retime[1].was, { startTime: null, duration: null }, "a record that was untimed says so");
  assert.deepEqual(ran.relay.map((r) => r.id), ["b"]);
  const open = heldEndPlan({ tail: { none: "noFigure" }, recipients, canWrite, now: 500 });
  assert.deepEqual(open.open.map((r) => r.id), ["a", "c"]);
  assert.deepEqual([open.remove.length, open.retime.length], [0, 0]);
  assert.deepEqual(heldEndPlan({ tail: TAIL, recipients: [rec("a")], now: 1 }).retime.map((r) => r.id), ["a"], "every record is writable by default");
});

t("a relayed end is refused for a seat that does not own the caster and while a held record of the cast still stands; a GM's own always passes the owner test", () => {
  const world = (over = {}) => ({ caster: { uuid: "Actor.c" }, ownsCaster: true, heldRemains: false, ...over });
  const req = { requestUserId: "u1", casterUuid: "Actor.c", castId: "x" };
  assert.deepEqual(checkHeldEndRequest(req, world()), { ok: true });
  assert.deepEqual(checkHeldEndRequest(req, world({ ownsCaster: false })), { refused: "notOwner" });
  assert.deepEqual(checkHeldEndRequest({ ...req, requestUserId: null }, world({ ownsCaster: false })), { ok: true });
  assert.deepEqual(checkHeldEndRequest(req, world({ heldRemains: true })), { refused: "heldRemains" });
  assert.deepEqual(checkHeldEndRequest(req, world({ caster: null })), { refused: "noCaster" });
  assert.deepEqual(checkHeldEndRequest({ requestUserId: "u1" }, world()), { refused: "noCast" });
});

/** A card flag as the funnel writes it, with one ended record, one re-timed and one open. */
const dataOf = (id, castId = "x", casterUuid = "Actor.c", role = "recipient") => ({
  _id: id,
  ...spellEffectData({ spell: { uuid: "Actor.c.Item.s", name: "Testhold", img: "i.png" }, caster: { uuid: casterUuid }, castId, role, startTime: 100 }),
});
const FLAG = () => ({
  cause: "damage",
  castId: "x",
  casterUuid: "Actor.c",
  spellUuid: "Actor.c.Item.s",
  spellName: "Testhold",
  casterName: "Testcaster",
  cite: "p. 1",
  ended: [{ actorUuid: "Actor.a", id: "ra", name: "Actor a", data: dataOf("ra") }],
  retimed: [{ actorUuid: "Actor.b", id: "rb", name: "Actor b", was: { startTime: 100, duration: { value: 1, units: "hours" } }, startTime: 500, duration: TAIL }],
  open: [{ actorUuid: "Actor.c2", id: "rc", name: "Actor c" }],
  caster: { actorUuid: "Actor.c", data: dataOf("rk", "x", "Actor.c", "caster") },
});

t("Restore is the inverse: the caster's record then each ended one, each with its own id, and the re-timings with their earlier figures", () => {
  const plan = restorePlan(FLAG());
  assert.deepEqual(plan.create.map((c) => [c.actorUuid, c.data._id]), [["Actor.c", "rk"], ["Actor.a", "ra"]]);
  assert.deepEqual(plan.undo, [{ actorUuid: "Actor.b", id: "rb", was: { startTime: 100, duration: { value: 1, units: "hours" } } }]);
  assert.equal(plan.skipped, 0);
  assert.deepEqual(plan.create[0].data.changes, []);
});

t("Restore writes only what the card's own cast made: another cast's data, a record with no mark and data with changes are not carried", () => {
  const flag = FLAG();
  flag.ended.push({ actorUuid: "Actor.z", id: "rz", name: "Z", data: dataOf("rz", "other-cast") });
  flag.ended.push({ actorUuid: "Actor.y", id: "ry", name: "Y", data: { _id: "ry", name: "Free", changes: [{ key: "system.hp.value", value: "999" }] } });
  flag.ended.push({ actorUuid: "Actor.w", id: "rw", name: "W", data: { ...dataOf("rw"), changes: [{ key: "system.hp.value", value: "999" }], system: { x: 1 } } });
  const plan = restorePlan(flag);
  assert.deepEqual(plan.create.map((c) => c.data._id), ["rk", "ra", "rw"]);
  assert.equal(plan.skipped, 2);
  const forged = plan.create.find((c) => c.data._id === "rw").data;
  assert.deepEqual(forged.changes, [], "a change list is always emptied");
  assert.equal(forged.system, undefined, "only the keys the module writes are kept");
});

await ta("running a plan counts a removal that found nothing as not ended, and records what each re-timing was", async () => {
  const plan = heldEndPlan({ tail: undefined, recipients: [rec("a"), rec("b")], now: 1 });
  const done = await runHeldPlan(plan, { remove: async (r) => r.id !== "b", retime: async () => {} });
  assert.deepEqual(done.ended.map((e) => e.id), ["a"]);
  const timed = await runHeldPlan(heldEndPlan({ tail: TAIL, recipients: [rec("a")], now: 7 }), { remove: async () => true, retime: async () => {} });
  assert.deepEqual(timed.retimed[0].duration, TAIL);
  assert.equal(timed.retimed[0].startTime, 7);
});

/** The funnel's deps, recorded. */
function funnelDeps({ recipients, relay, canWrite } = {}) {
  const calls = { removed: [], retimed: [], posted: [], relayed: [] };
  return {
    calls,
    deps: {
      now: () => 900,
      recipients: async () => recipients,
      canWrite,
      remove: async (r) => (calls.removed.push(r.id), true),
      retime: async (r) => void calls.retimed.push(r.id),
      relay: relay ? async (req) => (calls.relayed.push(req), relay(req)) : undefined,
      post: async (flag) => void calls.posted.push(flag),
    },
  };
}
const caster = { actorUuid: "Actor.c", name: "Testcaster", spellName: "Testhold", cite: "p. 1", data: dataOf("rk", "x", "Actor.c", "caster") };
const held = (tail) => ({ castId: "x", casterUuid: "Actor.c", spellUuid: "Actor.c.Item.s", role: "caster", held: "mobile", ...(tail ? { tail } : {}) });

await ta("the funnel ends what the client can write, relays the rest to the GM's client and posts one card naming all of it", async () => {
  const { deps, calls } = funnelDeps({
    recipients: [rec("a", { writable: true, data: dataOf("ra") }), rec("b", { writable: false })],
    canWrite: (r) => r.writable !== false,
    relay: () => ({ ok: true, ended: [{ actorUuid: "Actor.b", id: "rb", name: "Actor b", data: dataOf("rb") }], retimed: [], open: [] }),
  });
  const flag = await endHeldCast(held(), { cause: "damage", caster, deps });
  assert.deepEqual(calls.removed, ["a"]);
  assert.deepEqual(calls.relayed, [{ casterUuid: "Actor.c", castId: "x", cause: "damage" }], "the request holds no tail: the GM's client reads it from the spell");
  assert.equal(calls.posted.length, 1);
  assert.deepEqual(flag.ended.map((e) => e.id), ["a", "rb"]);
  assert.equal(flag.cause, "damage");
  assert.equal(flag.caster.data._id, "rk", "the card keeps the caster's record for Restore");
});

await ta("with no GM connected the records a seat cannot write stay and are listed with End; a tail re-times and a none tail lists every record", async () => {
  let r = funnelDeps({ recipients: [rec("a", { writable: true }), rec("b", { writable: false })], canWrite: (x) => x.writable !== false, relay: () => null });
  let flag = await endHeldCast(held(), { cause: "removed", caster, deps: r.deps });
  assert.deepEqual(flag.open.map((o) => o.id), ["b"]);
  assert.deepEqual(flag.ended.map((e) => e.id), ["a"]);
  r = funnelDeps({ recipients: [rec("a"), rec("b")] });
  flag = await endHeldCast(held(TAIL), { cause: "time", caster, deps: r.deps });
  assert.deepEqual([r.calls.removed, r.calls.retimed], [[], ["a", "b"]]);
  assert.deepEqual(flag.retimed.map((x) => x.id), ["a", "b"]);
  r = funnelDeps({ recipients: [rec("a")] });
  flag = await endHeldCast(held({ none: "noFigure" }), { cause: "cast", caster, deps: r.deps });
  assert.deepEqual([r.calls.removed, flag.open.map((o) => o.id)], [[], ["a"]]);
  assert.equal(r.calls.posted.length, 1);
  r = funnelDeps({ recipients: [] });
  await endHeldCast(held(), { cause: "removed", caster, deps: r.deps });
  assert.equal(r.calls.posted.length, 1, "a cast with no recipient still says its concentration ended");
});

const loc = (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key);

t("the card names the cause, lists what ended, what runs on and what stands, with a tooltip on each figure; Restore and End are in its body for the render hook to trim", () => {
  const html = heldEndContent(FLAG(), loc);
  assert.ok(html.includes("title|") && html.includes("cause.damage"));
  assert.ok(html.includes("Actor a") && html.includes("Actor b") && html.includes("Actor c"));
  assert.ok(html.includes('data-tooltip-text="tip.retimed|'), "the re-timed figure carries its tooltip");
  assert.ok(html.includes("2 rounds"));
  assert.ok(html.includes('data-acks-extras-held-end') && html.includes('data-record-id="rc"'));
  assert.ok(html.includes('data-acks-extras-held-restore') && html.includes('data-tooltip-text="tip.restore"'));
  const bare = heldEndContent({ ...FLAG(), ended: [], retimed: [], open: [], cause: "mystery" }, loc);
  assert.ok(bare.includes("cause.removed") && !bare.includes("<section>") && !bare.includes("data-acks-extras-held-end"), "an unknown cause reads as removed, and empty lists draw nothing");
  assert.ok(!heldEndContent({ ...FLAG(), spellName: "<b>x</b>" }, loc).includes("<b>x</b>"), "names are escaped");
});

await ta("a held summons' end lists the cast's standing creatures by name, token and stashed alike, and leaves the flag as it was where none stand", async () => {
  const asked = [];
  const r = funnelDeps({ recipients: [] });
  r.deps.standing = async (record) => (asked.push(record.castId), { tokens: [{ name: "Invented Wisp" }, { actor: { name: "Invented Sprite" } }], held: [{ name: "Invented Stashed" }] });
  const flag = await endHeldCast(held(), { cause: "damage", caster, deps: r.deps });
  assert.deepEqual(asked, ["x"], "asked of the record's own cast");
  assert.deepEqual(flag.summons, [{ name: "Invented Wisp" }, { name: "Invented Sprite" }, { name: "Invented Stashed" }]);
  assert.deepEqual(r.calls.removed, [], "the creatures are listed and never removed by the end");
  const none = funnelDeps({ recipients: [] });
  none.deps.standing = async () => ({ tokens: [], held: [] });
  assert.equal("summons" in (await endHeldCast(held(), { cause: "damage", caster, deps: none.deps })), false);
  const plan = restorePlan(flag);
  assert.deepEqual([plan.create.length, plan.undo.length, plan.skipped], [1, 0, 0], "Restore puts the record back and has nothing to say of the creatures");
});

t("the card lists the standing creatures with a Dismiss, drawn only when there are some; every name is escaped", () => {
  const html = heldEndContent({ ...FLAG(), summons: [{ name: "Invented Wisp" }, { name: "<i>x</i>" }] }, loc);
  assert.ok(html.includes("summons") && html.includes("Invented Wisp"));
  assert.ok(html.includes("data-acks-extras-held-dismiss") && html.includes('data-tooltip-text="tip.dismiss"'));
  assert.ok(!html.includes("<i>x</i>"), "escaped");
  assert.ok(!heldEndContent(FLAG(), loc).includes("data-acks-extras-held-dismiss"), "no creature, no Dismiss");
});

t("on a seat, Dismiss is kept for a GM seat alone, whoever owns the caster; Restore follows the same seat, and the lib dismissal is what decides who may remove", () => {
  const button = () => ({ removed: false, listeners: 0, remove() { this.removed = true; }, addEventListener() { this.listeners += 1; } });
  const seat = (isGM, owner) => {
    globalThis.game.user = { isGM };
    globalThis.fromUuidSync = () => ({ isOwner: owner });
    const dismiss = button();
    const restore = button();
    const end = button();
    end.dataset = { actorUuid: "Actor.c2" };
    const message = { flags: { "acks-extras": { castHeldEnd: { ...FLAG(), summons: [{ name: "Invented Wisp" }] } } } };
    const html = { querySelectorAll: (sel) => (sel.includes("dismiss") ? [dismiss] : sel.includes("restore") ? [restore] : [end]) };
    bindCard(message, html);
    return { dismiss, restore, end };
  };
  const gm = seat(true, false);
  assert.deepEqual([gm.dismiss.removed, gm.dismiss.listeners], [false, 1], "a GM seat keeps Dismiss and wires it");
  const owner = seat(false, true);
  assert.deepEqual([owner.dismiss.removed, owner.dismiss.listeners], [true, 0], "an owner's seat is not a GM's: Dismiss is removed");
  assert.equal(owner.end.removed, false, "End keeps its own owner test, which Dismiss does not copy");
  const other = seat(false, false);
  assert.equal(other.dismiss.removed, true);
  delete globalThis.game.user;
  delete globalThis.fromUuidSync;
});

console.log(`\n${n} cast-held tests passed`);
