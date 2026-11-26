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

import fs from "node:fs";
const Handlebars = (await import("handlebars")).default;

// The card's own template file, compiled as Foundry compiles it: no helper registered beyond the ones core has.
const CARD = Handlebars.compile(fs.readFileSync(new URL("../templates/magic/cast-held-card.hbs", import.meta.url), "utf8"));
globalThis.foundry = {
  data: { operators: { ForcedDeletion: class ForcedDeletion {} } },
  utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) },
  applications: { handlebars: { renderTemplate: async (path, view) => (path.endsWith("cast-held-card.hbs") ? CARD(view) : "") } },
};
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };

const { heldStatusOf, heldRecordData, causeOf, heldEndPlan, checkHeldEndRequest, checkRestoreRequest, restoreSplit, restorePlan, restoredAs, runHeldPlan, endHeldCast, heldEndContent, heldEndView, controlLostLine, pressDismiss, bindCard, HELD_CAUSES } = await import("../scripts/magic/cast-held.mjs");
const { spellEffectData, spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { conditionChanges } = await import("./core-conditions-fixture.mjs");

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
  assert.equal(heldStatusOf("stationary"), "concentrating-and-stationary");
  assert.equal(heldStatusOf("mobile"), "concentrating");
  assert.equal(heldStatusOf(undefined), "concentrating");
});

const MARK = { spell: { uuid: "Actor.c1.Item.s1", name: "Invented Hold", img: "icons/invented.webp" }, caster: { uuid: "Actor.c1" }, castId: "cast0001", role: "caster" };

t("a held record is the caster's status-only record: the status for its kind, the kind, the tail, the clock started now and the cap as its flag-timed duration", () => {
  const cap = { value: 12, units: "rounds" };
  const tail = { value: 2, units: "rounds" };
  const data = heldRecordData(MARK, { held: "stationary", now: 40, tail, cap });
  assert.deepEqual(data, spellEffectData({ ...MARK, startTime: 40, statuses: ["concentrating-and-stationary"], held: "stationary", tail, duration: cap }));
  assert.deepEqual(data.statuses, ["concentrating-and-stationary"]);
  assert.equal(data.changes.length, 0);
  assert.equal(data.system, undefined, "a held record holds the one status of its kind and no figure");
  assert.throws(() => spellEffectData({ ...MARK, startTime: 40, statuses: ["concentrating-and-stationary", "other"], held: "stationary" }), /exactly what the builder returned/);
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

t("a restored record of a condition takes its statuses and figures from the builder, never from the card; data the builder did not answer is left as it is", () => {
  const built = { statuses: ["rush", "muddle"], system: { changes: conditionChanges("charging") } };
  const stored = { _id: "ra", name: "A", statuses: ["rush"], changes: [], flags: {} };
  const out = restoredAs(stored, built);
  assert.deepEqual(out.statuses, ["rush", "muddle"]);
  assert.deepEqual(out.system.changes, conditionChanges("charging"));
  assert.equal(out.changes, undefined);
  out.system.changes[0].value = 0;
  assert.equal(built.system.changes[0].value, conditionChanges("charging")[0].value, "copied, not shared");
  assert.deepEqual(restoredAs(stored, { statuses: ["rush"] }), { _id: "ra", name: "A", statuses: ["rush"], changes: [], flags: {} }, "a condition with no figure restores with none");
  assert.equal(restoredAs(stored, { statuses: ["other"], system: built.system }), stored, "a builder answer for another status is not used");
  const bare = { _id: "rb", flags: {} };
  assert.equal(restoredAs(bare, built), bare);
  const forged = restorePlan({ ...FLAG(), ended: [{ actorUuid: "Actor.w", id: "rw", name: "W", data: { ...dataOf("rw"), statuses: ["rush"], system: { changes: [{ key: "system.hp.value", type: "add", value: 999 }] } } }] }).create.find((c) => c.data._id === "rw").data;
  assert.equal(forged.system, undefined, "the plan still drops what the card holds");
  assert.deepEqual(restoredAs(forged, built).system.changes, conditionChanges("charging"), "and the figure a restored record carries is the builder's");
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
const caster = { actorUuid: "Actor.c", name: "Testcaster", img: "icons/invented-caster.webp", spellName: "Testhold", cite: "p. 1", data: dataOf("rk", "x", "Actor.c", "caster") };
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
  assert.equal(r.calls.posted[0].casterImg, "icons/invented-caster.webp", "the caster's portrait rides the flag");
  r = funnelDeps({ recipients: [] });
  await endHeldCast(held(), { cause: "removed", caster, deps: r.deps });
  assert.equal(r.calls.posted.length, 1, "a cast with no recipient still says its concentration ended");
});

const loc = (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key);

const count = (html, needle) => html.split(needle).length - 1;
const SUMMONS = () => [
  { name: "Invented Wisp", img: "icons/invented-wisp.webp", tokenUuid: "Scene.s1.Token.t1" },
  { name: "<i>x</i>", img: "", tokenUuid: "Scene.s1.Token.t2" },
  { name: "Invented Stashed", img: "icons/invented-stashed.webp", held: { partyId: "party1", actorId: "member1" } },
];

await ta("the card names the cause, lists what ended, what runs on and what stands, with a tooltip on each figure; Restore and End are in its body for the render hook to trim", async () => {
  const html = await heldEndContent(FLAG(), loc);
  assert.ok(html.includes("title") && html.includes("byline|") && html.includes("cause.damage"));
  assert.ok(html.includes("cause.damage (p. 1)"), "with no creature the cause line carries the page reference");
  assert.ok(html.includes("Actor a") && html.includes("Actor b") && html.includes("Actor c"));
  assert.ok(html.includes('data-tooltip-text="tip.retimed|'), "the re-timed figure carries its tooltip");
  assert.ok(html.includes("2 rounds"));
  assert.ok(html.includes("data-acks-extras-held-end") && html.includes('data-record-id="rc"'));
  assert.ok(html.includes("data-acks-extras-held-restore") && html.includes('data-tooltip-text="tip.restore"'));
  assert.equal(count(html, "data-acks-extras-held-dismiss"), 0, "no creature, no Dismiss");
  assert.ok(!html.includes("controlLost"), "no creature, no control-lost line");
  const bare = await heldEndContent({ ...FLAG(), ended: [], retimed: [], open: [], cause: "mystery" }, loc);
  assert.ok(bare.includes("cause.removed") && !bare.includes("<section") && !bare.includes("data-acks-extras-held-end"), "an unknown cause reads as removed, and empty lists draw nothing");
  assert.ok(!(await heldEndContent({ ...FLAG(), spellName: "<b>x</b>" }, loc)).includes("<b>x</b>"), "names are escaped");
  assert.ok((await heldEndContent({ ...FLAG(), casterImg: "icons/invented-caster.webp" }, loc)).includes('src="icons/invented-caster.webp"'), "the caster's portrait heads the card");
});

await ta("a held summons' end lists the cast's standing creatures by name, token and stashed alike, and leaves the flag as it was where none stand", async () => {
  const asked = [];
  const r = funnelDeps({ recipients: [] });
  r.deps.standing = async (record) => (asked.push(record.castId), { tokens: [{ name: "Invented Wisp", uuid: "Scene.s1.Token.t1", texture: { src: "icons/invented-wisp.webp" } }, { actor: { name: "Invented Sprite", img: "icons/invented-sprite.webp" }, uuid: "Scene.s1.Token.t2" }], held: [{ name: "Invented Stashed", img: "", partyId: "party1", actorId: "member1" }] });
  const flag = await endHeldCast(held(), { cause: "damage", caster, deps: r.deps });
  assert.deepEqual(asked, ["x"], "asked of the record's own cast");
  assert.deepEqual(flag.summons, [
    { name: "Invented Wisp", img: "icons/invented-wisp.webp", tokenUuid: "Scene.s1.Token.t1" },
    { name: "Invented Sprite", img: "icons/invented-sprite.webp", tokenUuid: "Scene.s1.Token.t2" },
    { name: "Invented Stashed", img: "", held: { partyId: "party1", actorId: "member1" } },
  ]);
  assert.deepEqual(r.calls.removed, [], "the creatures are listed and never removed by the end");
  const none = funnelDeps({ recipients: [] });
  none.deps.standing = async () => ({ tokens: [], held: [] });
  assert.equal("summons" in (await endHeldCast(held(), { cause: "damage", caster, deps: none.deps })), false);
  const plan = restorePlan(flag);
  assert.deepEqual([plan.create.length, plan.undo.length, plan.skipped], [1, 0, 0], "Restore puts the record back and has nothing to say of the creatures");
});

t("the control-lost line is one function of the outcome: each of stays, gone and hostile has its own wording, anything else draws nothing", () => {
  assert.equal(controlLostLine("stays", loc), "controlLost.stays");
  assert.equal(controlLostLine(undefined, loc), "controlLost.stays", "stays is the default");
  assert.equal(controlLostLine("gone", loc), "controlLost.gone");
  assert.equal(controlLostLine("hostile", loc), "controlLost.hostile");
  assert.equal(controlLostLine("vanish", loc), "", "an outcome the vocabulary lacks writes no line");
  assert.equal(heldEndView({ ...FLAG(), summons: SUMMONS() }, loc).controlLost, "controlLost.stays (p. 1)");
  assert.equal(heldEndView({ ...FLAG(), summons: SUMMONS(), outcome: "gone" }, loc).controlLost, "controlLost.gone (p. 1)");
  assert.equal(heldEndView({ ...FLAG(), summons: SUMMONS(), outcome: "hostile" }, loc).controlLost, "controlLost.hostile (p. 1)");
  assert.equal(heldEndView({ ...FLAG(), summons: SUMMONS(), outcome: "vanish" }, loc).controlLost, "", "an unknown outcome writes no line");
});

await ta("the card of creatures that went draws no Dismiss, a row nor the whole cast's; one that turned hostile keeps both", async () => {
  const gone = await heldEndContent({ ...FLAG(), summons: SUMMONS(), outcome: "gone" }, loc);
  assert.equal(count(gone, "data-acks-extras-held-dismiss"), 0, "nothing is left to dismiss");
  assert.ok(gone.includes("controlLost.gone (p. 1)") && gone.includes("summonsGone") && gone.includes("Invented Wisp"), "the line says so and the creatures that went are still named");
  assert.ok(gone.includes("data-acks-extras-held-restore"), "Restore stays");
  const hostile = await heldEndContent({ ...FLAG(), summons: SUMMONS(), outcome: "hostile" }, loc);
  assert.equal(count(hostile, "data-acks-extras-held-dismiss"), 4);
  assert.ok(hostile.includes("controlLost.hostile (p. 1)"));
});

await ta("the end asks the GM's client to end the creatures' control, only where creatures stand, and the card's flag carries the outcome it answered", async () => {
  const asked = [];
  const standing = async () => ({ tokens: [{ name: "Invented Wisp", uuid: "Scene.s1.Token.t1" }], held: [] });
  for (const outcome of ["stays", "gone", "hostile"]) {
    const r = funnelDeps({ recipients: [] });
    r.deps.standing = standing;
    r.deps.control = async (req) => (asked.push(req), { ok: true, outcome });
    const flag = await endHeldCast(held(), { cause: "damage", caster, deps: r.deps });
    assert.equal(flag.outcome, outcome);
    assert.deepEqual(r.calls.removed, [], "the creatures are never removed by this client");
  }
  assert.deepEqual(asked[0], { casterUuid: "Actor.c", castId: "x", cause: "damage" }, "the request names the cast and holds no outcome");
  const noGm = funnelDeps({ recipients: [] });
  noGm.deps.standing = standing;
  noGm.deps.control = async () => null;
  assert.equal("outcome" in (await endHeldCast(held(), { cause: "damage", caster, deps: noGm.deps })), false, "with no GM nothing is applied and no outcome is claimed");
  const refused = funnelDeps({ recipients: [] });
  refused.deps.standing = standing;
  refused.deps.control = async () => ({ ok: false, reason: "noCaster" });
  assert.equal("outcome" in (await endHeldCast(held(), { cause: "damage", caster, deps: refused.deps })), false, "a refusal claims no outcome");
  const none = funnelDeps({ recipients: [] });
  none.deps.standing = async () => ({ tokens: [], held: [] });
  none.deps.control = async () => assert.fail("no creature stands, so nothing is asked");
  await endHeldCast(held(), { cause: "damage", caster, deps: none.deps });
});

await ta("a stashed creature that left its party is listed by the token that stands for it, the card says who left and who stays on the roster, each on its own line", async () => {
  const r = funnelDeps({ recipients: [] });
  r.deps.standing = async () => ({ tokens: [{ name: "Invented Wisp", uuid: "Scene.s1.Token.t1" }], held: [{ name: "Invented Stashed", img: "", partyId: "party1", actorId: "member1" }, { name: "Invented Kept", img: "", partyId: "party1", actorId: "member2" }] });
  r.deps.control = async () => ({
    ok: true,
    outcome: "hostile",
    left: [{ partyId: "party1", actorId: "member1", name: "Invented Stashed", tokenUuid: "Scene.s9.Token.new1", deployed: false }],
    kept: [{ partyId: "party1", actorId: "member2", name: "Invented Kept" }],
  });
  const flag = await endHeldCast(held(), { cause: "damage", caster, deps: r.deps });
  assert.deepEqual(flag.summons[1], { name: "Invented Stashed", img: "", tokenUuid: "Scene.s9.Token.new1" }, "its roster row is gone, so Dismiss names the token");
  assert.deepEqual(flag.summons[2].held, { partyId: "party1", actorId: "member2" }, "one the roster kept is still its row");
  assert.deepEqual([flag.left, flag.kept], [[{ name: "Invented Stashed" }], [{ name: "Invented Kept" }]]);
  const view = heldEndView(flag, loc);
  assert.equal(view.leftParty, 'leftParty|{"names":"Invented Stashed"}');
  assert.equal(view.keptInParty, 'keptInParty|{"names":"Invented Kept"}');
  assert.equal(view.controlLost, "controlLost.hostile (p. 1)", "the page's own line is not extended with the departure");
  assert.equal(heldEndView({ ...FLAG(), summons: SUMMONS(), outcome: "hostile" }, loc).leftParty, "", "no departure, no line");
  const plain = funnelDeps({ recipients: [] });
  plain.deps.standing = async () => ({ tokens: [{ name: "Invented Wisp", uuid: "Scene.s1.Token.t1" }], held: [] });
  plain.deps.control = async () => ({ ok: true, outcome: "hostile" });
  const unchanged = await endHeldCast(held(), { cause: "damage", caster, deps: plain.deps });
  assert.equal("left" in unchanged || "kept" in unchanged, false);
});

await ta("every cause of a held end asks for the control end alike and the card carries what it answered: a conjuration capped by time ends as one broken by damage, by a save, by a new cast or by a hand", async () => {
  const standing = async () => ({ tokens: [{ name: "Invented Wisp", uuid: "Scene.s1.Token.t1" }], held: [] });
  for (const cause of HELD_CAUSES) {
    const asked = [];
    const r = funnelDeps({ recipients: [] });
    r.deps.standing = standing;
    r.deps.control = async (req) => (asked.push(req), { ok: true, outcome: "hostile" });
    const flag = await endHeldCast(held(), { cause, caster, deps: r.deps });
    assert.equal(asked.length, 1, `${cause}: the GM's client is asked once`);
    assert.equal(flag.outcome, "hostile", `${cause}: the card carries the outcome`);
    assert.equal(flag.cause, cause);
  }
});

await ta("the card lists the standing creatures, a Dismiss on each row and one for all, the page reference once on the control-lost line; every name is escaped", async () => {
  const html = await heldEndContent({ ...FLAG(), summons: SUMMONS() }, loc);
  assert.equal(count(html, "data-acks-extras-held-dismiss"), 4, "one per creature, and one for the whole cast");
  assert.equal(count(html, 'data-all="1"'), 1);
  assert.ok(html.includes("summons") && html.includes("Invented Wisp") && html.includes("Invented Stashed"));
  assert.ok(html.includes('data-token-uuid="Scene.s1.Token.t1"') && html.includes('data-party-id="party1"') && html.includes('data-member-id="member1"'), "each Dismiss names its creature");
  assert.ok(html.includes('src="icons/invented-wisp.webp"') && html.includes("fa-ghost"), "token art, and a glyph where a creature has none");
  assert.ok(html.includes("aria.dismiss|") && html.includes("Invented Wisp&quot;}") && html.includes('data-tooltip-text="tip.dismiss|'), "a name and a tooltip on each");
  assert.ok(html.includes("controlLost.stays (p. 1)") && !html.includes("cause.damage (p. 1)"), "the page reference is on the control-lost line alone");
  assert.ok(html.includes("data-acks-extras-held-restore"), "Restore stays beside Dismiss all");
  assert.ok(!html.includes("<i>x</i>"), "escaped");
  assert.ok(html.includes("acks-extras-bucket__row"), "the rows are lib's bucket rows");
  assert.ok(!/\sid=/.test(html), "no id is drawn, so two copies of the card never share one");
});

const press = async (flag, dataset) => {
  const calls = [];
  const lib = {
    caster: { uuid: "Actor.c" },
    castSummons: (caster, castId) => (calls.push(["castSummons", caster.uuid, castId]), { tokens: [{ id: "t1" }], held: [{ partyId: "party1", actorId: "member1" }] }),
    promptDismiss: async (caster, options) => (calls.push(["promptDismiss", caster.uuid, options]), { ok: true, deleted: 1 }),
  };
  globalThis.game.scenes = ["scenes"];
  const answer = await pressDismiss(flag, dataset, lib);
  return { calls, answer };
};

await ta("a row's Dismiss asks the dismissal for that creature alone, of this cast; Dismiss all asks for every creature of the cast", async () => {
  const flag = { ...FLAG(), summons: SUMMONS() };
  const token = await press(flag, { tokenUuid: "Scene.s1.Token.t1" });
  assert.deepEqual(token.calls, [["promptDismiss", "Actor.c", { entries: [{ tokenUuid: "Scene.s1.Token.t1" }], castId: "x" }]]);
  assert.equal(token.answer.ok, true);
  const stashed = await press(flag, { partyId: "party1", memberId: "member1" });
  assert.deepEqual(stashed.calls, [["promptDismiss", "Actor.c", { entries: [{ held: { partyId: "party1", actorId: "member1" } }], castId: "x" }]]);
  const all = await press(flag, { all: "1" });
  assert.deepEqual(all.calls, [["castSummons", "Actor.c", "x"], ["promptDismiss", "Actor.c", { tokens: [{ id: "t1" }], held: [{ partyId: "party1", actorId: "member1" }], castId: "x" }]]);
  globalThis.fromUuidSync = () => null;
  const gone = await pressDismiss(flag, { all: "1" }, { promptDismiss: async () => assert.fail("no caster, no dismissal"), castSummons: () => assert.fail("no caster, no dismissal") });
  assert.equal(gone, null, "a caster no longer in the world dismisses nothing");
  delete globalThis.fromUuidSync;
  delete globalThis.game.scenes;
});

await ta("on a seat, Restore, Dismiss and Dismiss all follow ownership of the caster, End follows ownership of its record, and a hostile card keeps Dismiss for a GM seat alone; the lib dismissal is what decides who may remove", async () => {
  const html0 = await heldEndContent({ ...FLAG(), summons: SUMMONS() }, loc);
  const asked = [];
  const button = (attrs = {}) => ({ removed: false, listeners: 0, dataset: attrs, remove() { this.removed = true; }, addEventListener() { this.listeners += 1; } });
  const seat = ({ isGM = false, owner = false, end = owner, outcome } = {}) => {
    globalThis.game.user = { isGM };
    globalThis.fromUuidSync = (uuid) => ({ isOwner: uuid === "Actor.c2" ? end : owner });
    const dismiss = [button({ tokenUuid: "a" }), button({ tokenUuid: "b" }), button({ partyId: "p", memberId: "m" }), button({ all: "1" })];
    const restore = button();
    const endButton = button({ actorUuid: "Actor.c2" });
    const foot = { removed: false, children: owner ? [{}, {}] : [], remove() { this.removed = true; } };
    const message = { flags: { "acks-extras": { castHeldEnd: { ...FLAG(), summons: SUMMONS(), ...(outcome ? { outcome } : {}) } } } };
    const html = {
      querySelectorAll: (sel) => (asked.push(sel), sel.includes("dismiss") ? dismiss : sel.includes("restore") ? [restore] : [endButton]),
      querySelector: () => foot,
    };
    bindCard(message, html);
    return { dismiss, restore, end: endButton, foot };
  };
  const kept = (seatResult) => [seatResult.dismiss.map((d) => !d.removed && d.listeners === 1), !seatResult.restore.removed, !seatResult.end.removed];
  const ownerSeat = seat({ owner: true, outcome: "stays" });
  assert.deepEqual(kept(ownerSeat), [[true, true, true, true], true, true], "an owner of the caster keeps every Dismiss, Restore and its End, with no GM seat");
  assert.equal(ownerSeat.foot.removed, false);
  assert.deepEqual(kept(seat({ owner: true })), [[true, true, true, true], true, true], "a card with no outcome draws Dismiss for an owner");
  assert.deepEqual(kept(seat({ owner: true, outcome: "gone" })), [[true, true, true, true], true, true], "so does one whose creatures went");
  const hostile = seat({ owner: true, outcome: "hostile" });
  assert.deepEqual(kept(hostile), [[false, false, false, false], true, true], "an owner of a hostile card loses Dismiss and keeps Restore, which touches no creature");
  assert.deepEqual(kept(seat({ isGM: true, owner: true, outcome: "hostile" })), [[true, true, true, true], true, true], "a GM seat keeps Dismiss on a hostile card");
  const stranger = seat({ owner: false, outcome: "stays" });
  assert.deepEqual(kept(stranger), [[false, false, false, false], false, false], "a seat that owns nothing keeps nothing");
  assert.equal(stranger.foot.removed, true, "the footer nothing is left in is taken away empty");
  assert.deepEqual(kept(seat({ owner: true, end: false })).slice(1), [true, false], "End keeps its own record's ownership test");
  assert.ok(asked.includes("[data-acks-extras-held-dismiss]"), "the hook asks for the attribute the template draws");
  for (const attr of ["data-acks-extras-held-dismiss", "data-acks-extras-held-restore", "data-acks-extras-held-end"]) assert.ok(html0.includes(attr), `the template draws ${attr}`);
  delete globalThis.game.user;
  delete globalThis.fromUuidSync;
});

t("a relayed Restore is refused for a card no longer in the world, then one already restored, then a requester who does not own its caster; a GM's own request carries no user id and always passes the owner test", () => {
  const flag = FLAG();
  const req = { requestUserId: "u1", op: "restore", messageId: "m" };
  assert.deepEqual(checkRestoreRequest(req, { flag, ownsCaster: true }), { ok: true });
  assert.deepEqual(checkRestoreRequest(req, { flag: undefined, ownsCaster: true }), { refused: "noCard" });
  assert.deepEqual(checkRestoreRequest(req, { flag: { ...flag, restored: { by: "x" } }, ownsCaster: false }), { refused: "restored" }, "restored is named before the owner test");
  assert.deepEqual(checkRestoreRequest(req, { flag: undefined, ownsCaster: false }), { refused: "noCard" }, "no card is named before the owner test");
  assert.deepEqual(checkRestoreRequest(req, { flag, ownsCaster: false }), { refused: "notOwner" });
  assert.deepEqual(checkRestoreRequest({ ...req, requestUserId: null }, { flag, ownsCaster: false }), { ok: true });
  assert.deepEqual(checkRestoreRequest(undefined, undefined), { refused: "noCard" });
});

t("a restore plan splits by who may write each actor: the records kept are the writer's, the rest are counted and nothing is lost to the count", () => {
  const plan = restorePlan(FLAG());
  const all = restoreSplit(plan, () => true);
  assert.deepEqual([all.plan.create.length, all.plan.undo.length, all.refused], [2, 1, 0]);
  const some = restoreSplit(plan, (uuid) => uuid === "Actor.c");
  assert.deepEqual(some.plan.create.map((c) => c.data._id), ["rk"]);
  assert.deepEqual([some.plan.undo.length, some.refused, some.plan.skipped], [0, 2, plan.skipped]);
  const none = restoreSplit(plan, () => false);
  assert.deepEqual([none.plan.create.length, none.plan.undo.length, none.refused], [0, 0, 3]);
  assert.deepEqual(plan.create.length + plan.undo.length, 3, "the plan it was given is not changed");
});

/** The Restore tests' world: a card, its users and the actors its records belong to. */
const restoreWorld = ({ authorGM = true, owned = {}, cardOwner = true } = {}) => {
  const log = { created: [], undone: [], messageUpdates: [] };
  const actors = {};
  const actorDoc = (uuid, effects = []) => {
    const own = new Map(effects.map((e) => [e.id, e]));
    actors[uuid] = {
      uuid,
      get isOwner() { return owned[game.user?.id]?.includes(uuid) === true; },
      effects: { has: (id) => own.has(id), get: (id) => own.get(id) },
      testUserPermission: (user) => owned[user.id]?.includes(uuid) === true,
      createEmbeddedDocuments: async (_kind, docs) => { for (const d of docs) { log.created.push([uuid, d._id]); own.set(d._id, d); } return docs; },
    };
  };
  actorDoc("Actor.c");
  actorDoc("Actor.a");
  actorDoc("Actor.b", [{ id: "rb", update: async (patch) => log.undone.push(patch) }]);
  const message = { id: "m1", flags: { "acks-extras": { castHeldEnd: FLAG() } }, isOwner: cardOwner, author: { isGM: authorGM }, update: async (patch) => log.messageUpdates.push(patch) };
  const users = new Map([["gm", { id: "gm", name: "Judge", isGM: true }], ["p1", { id: "p1", name: "Player One", isGM: false }], ["p2", { id: "p2", name: "Player Two", isGM: false }]]);
  globalThis.fromUuid = async (uuid) => actors[uuid] ?? null;
  globalThis.fromUuidSync = (uuid) => actors[uuid] ?? null;
  Object.assign(globalThis.game, { users, messages: { get: (id) => (id === "m1" ? message : null) }, user: { id: "p1", name: "Player One", isGM: false } });
  return { log, message, actors };
};
const restoreWorldDown = () => {
  delete globalThis.fromUuid;
  delete globalThis.fromUuidSync;
  delete globalThis.game.users;
  delete globalThis.game.messages;
  delete globalThis.game.user;
};
const { magicHeldEnd, pressRestore } = await import("../scripts/magic/cast-held.mjs");

await ta("the GM's client restores a GM-authored card in full for an owner of its caster, and stamps it restored by that user", async () => {
  const w = restoreWorld({ authorGM: true, owned: { p1: ["Actor.c"] } });
  const answer = await magicHeldEnd({ op: "restore", messageId: "m1", requestUserId: "p1" });
  assert.deepEqual(answer, { ok: true, restored: 3, refused: 0 });
  assert.deepEqual(w.log.created, [["Actor.c", "rk"], ["Actor.a", "ra"]], "every record the card lists is put back, on actors the sender does not own too");
  assert.equal(w.log.undone.length, 1, "and the re-timing is undone");
  assert.deepEqual(w.log.messageUpdates, [{ "flags.acks-extras.castHeldEnd.restored": { by: "Player One" } }]);
  restoreWorldDown();
});

await ta("a card a seat authored writes only the actors the sender owns, counts the rest and is not stamped restored", async () => {
  const w = restoreWorld({ authorGM: false, owned: { p1: ["Actor.c"] } });
  const answer = await magicHeldEnd({ op: "restore", messageId: "m1", requestUserId: "p1" });
  assert.deepEqual(answer, { ok: true, restored: 1, refused: 2 });
  assert.deepEqual(w.log.created, [["Actor.c", "rk"]], "the caster's own record goes back, the others' do not");
  assert.deepEqual([w.log.undone.length, w.log.messageUpdates.length], [0, 0], "nothing is undone on an actor the sender does not own, and the card stays open for its owners");
  const again = await magicHeldEnd({ op: "restore", messageId: "m1", requestUserId: "p1" });
  assert.deepEqual(again, { ok: true, restored: 0, refused: 2 }, "a repeat finds the record already back");
  w.actors["Actor.a"].testUserPermission = () => true;
  w.actors["Actor.b"].testUserPermission = () => true;
  const whole = await magicHeldEnd({ op: "restore", messageId: "m1", requestUserId: "p1" });
  assert.deepEqual([whole.ok, whole.refused, w.log.messageUpdates.length], [true, 0, 1], "once everything is owned it is whole, and stamped");
  restoreWorldDown();
});

await ta("a seat-authored card restored with no requester id (a GM's own call) writes every actor", async () => {
  const w = restoreWorld({ authorGM: false });
  const answer = await magicHeldEnd({ op: "restore", messageId: "m1" });
  assert.deepEqual(answer, { ok: true, restored: 3, refused: 0 });
  assert.equal(w.log.messageUpdates.length, 1);
  restoreWorldDown();
});

await ta("a Restore request is refused with no card, an already restored card and a user who owns neither the caster, and is checked before the held-end head that wants a casterUuid", async () => {
  const w = restoreWorld({ authorGM: true, owned: { p1: ["Actor.c"] } });
  assert.deepEqual(await magicHeldEnd({ op: "restore", messageId: "gone", requestUserId: "p1" }), { ok: false, reason: "noCard" });
  assert.deepEqual(await magicHeldEnd({ op: "restore", requestUserId: "p1" }), { ok: false, reason: "noCard" }, "a request that names no card");
  assert.deepEqual(await magicHeldEnd({ op: "restore", messageId: "m1", requestUserId: "p2" }), { ok: false, reason: "notOwner" });
  assert.deepEqual(await magicHeldEnd({ op: "restore", messageId: "m1", requestUserId: "nobody" }), { ok: false, reason: "notOwner" }, "an id no user answers to owns nothing");
  assert.deepEqual([w.log.created.length, w.log.messageUpdates.length], [0, 0], "a refusal writes nothing");
  w.message.flags["acks-extras"].castHeldEnd.restored = { by: "Judge" };
  assert.deepEqual(await magicHeldEnd({ op: "restore", messageId: "m1", requestUserId: "p1" }), { ok: false, reason: "restored" });
  restoreWorldDown();
});

await ta("a Restore press writes directly when the seat owns the card and every actor in the plan, and relays {op: \"restore\", messageId} otherwise, telling the presser what was left", async () => {
  const once = {};
  const priorHooks = globalThis.Hooks;
  const priorSocketlib = globalThis.socketlib;
  const priorUi = globalThis.ui;
  globalThis.Hooks = { once: (name, fn) => (once[name] = fn), on() {} };
  const sent = [];
  let reply;
  globalThis.socketlib = { registerModule: () => ({ register() {}, executeAsGM: async (action, payload) => (sent.push([action, payload]), reply) }) };
  const warned = [];
  globalThis.ui = { notifications: { warn: (text) => warned.push(text) } };
  await import("../scripts/lib/sockets.mjs");
  once["socketlib.ready"]();
  const priorFormat = globalThis.game.i18n.format;
  globalThis.game.i18n.format = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);
  const mine = restoreWorld({ authorGM: false, owned: { p1: ["Actor.c", "Actor.a", "Actor.b"] } });
  globalThis.game.users.activeGM = { id: "gm" };
  await pressRestore(mine.message);
  assert.equal(sent.length, 0, "a seat that owns the card and every actor writes itself");
  assert.deepEqual(mine.log.created, [["Actor.c", "rk"], ["Actor.a", "ra"]]);
  assert.deepEqual(mine.log.messageUpdates, [{ "flags.acks-extras.castHeldEnd.restored": { by: "Player One" } }]);
  restoreWorldDown();

  const partial = restoreWorld({ authorGM: true, owned: { p1: ["Actor.c"] } });
  globalThis.game.users.activeGM = { id: "gm" };
  reply = { ok: true, restored: 1, refused: 2 };
  await pressRestore(partial.message);
  assert.deepEqual(sent, [["magicHeldEnd", { op: "restore", messageId: "m1" }]], "an actor the seat does not own sends the card's id and nothing else");
  assert.equal(partial.log.created.length, 0, "and the seat writes nothing itself");
  assert.deepEqual(warned, ['ACKS-MAGIC.castHeld.notice.restorePartial {"done":1,"left":2}'], "a partial answer is told to the presser");
  restoreWorldDown();

  const notMine = restoreWorld({ authorGM: true, cardOwner: false, owned: { p1: ["Actor.c", "Actor.a", "Actor.b"] } });
  globalThis.game.users.activeGM = { id: "gm" };
  reply = { ok: true, restored: 3, refused: 0 };
  await pressRestore(notMine.message);
  assert.equal(sent.length, 2, "a card the seat cannot edit is relayed even when every actor is its own");
  assert.equal(warned.length, 1, "a whole restore says nothing more");
  restoreWorldDown();

  const closed = restoreWorld({ authorGM: true, owned: { p1: ["Actor.c"] } });
  closed.message.flags["acks-extras"].castHeldEnd.restored = { by: "Judge" };
  await pressRestore(closed.message);
  assert.equal(sent.length, 2, "a restored card is not pressed again");
  restoreWorldDown();

  globalThis.game.i18n.format = priorFormat;
  for (const [key, value] of [["Hooks", priorHooks], ["socketlib", priorSocketlib], ["ui", priorUi]]) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
});

/* -------------------------------------------- */
/*  A Judge's hand on one cast's control end    */
/* -------------------------------------------- */

const hand = await import("../scripts/magic/cast-control-hand.mjs");

const handLoc = (key) => `castControl.${key}`;

t("the select's view: Under control then the three ends, the recorded outcome selected, a hint for it, a label, an aria-label and a tooltip key; with no outcome recorded an unpickable first option", () => {
  const view = hand.controlView({ ...FLAG(), summons: SUMMONS(), outcome: "hostile" }, handLoc);
  assert.deepEqual(view.options.map((o) => [o.value, o.label, o.selected]), [["control", "castControl.option.control", false], ["stays", "castControl.option.stays", false], ["gone", "castControl.option.gone", false], ["hostile", "castControl.option.hostile", true]]);
  assert.equal(view.value, "hostile");
  assert.equal(view.hint, "castControl.hint.hostile", "a line says what the chosen value did");
  assert.deepEqual([view.label, view.aria, view.tip], ["castControl.label", "castControl.aria", "ACKS-MAGIC.castControl.tip"]);
  for (const outcome of [undefined, "vanish"]) {
    const bare = hand.controlView({ ...FLAG(), summons: SUMMONS(), outcome }, handLoc);
    assert.deepEqual(bare.options[0], { value: "", label: "castControl.option.unrecorded", selected: true, disabled: true }, "Not recorded, selected and not pickable");
    assert.deepEqual([bare.value, bare.options.length, bare.hint], ["", 5, ""]);
  }
  assert.equal(hand.controlView({ ...FLAG(), outcome: "control" }, handLoc).options.length, 4, "a recorded outcome has no Not recorded");
  assert.deepEqual(hand.CONTROL_PICKS, ["control", "stays", "gone", "hostile"]);
});

t("the control-lost line also speaks for creatures set back under control; a value set by hand names who set it and drops the page reference; the kept line is not drawn under control", () => {
  assert.equal(controlLostLine("control", loc), "controlLost.control");
  assert.equal(heldEndView({ ...FLAG(), summons: SUMMONS(), outcome: "control" }, loc).controlLost, "controlLost.control (p. 1)", "the row's own outcome keeps its page reference");
  const hand1 = heldEndView({ ...FLAG(), summons: SUMMONS(), outcome: "control", setBy: "Judge" }, loc, (name) => `by ${name}`);
  assert.deepEqual([hand1.controlLost, hand1.setBy], ["controlLost.control", "by Judge"]);
  assert.equal(heldEndView({ ...FLAG(), summons: SUMMONS(), outcome: "hostile" }, loc).setBy, "", "no hand, no line");
  const kept = { ...FLAG(), summons: SUMMONS(), kept: [{ name: "K" }], left: [{ name: "L" }] };
  assert.equal(heldEndView({ ...kept, outcome: "hostile" }, loc).keptInParty, 'keptInParty|{"names":"K"}');
  assert.equal(heldEndView({ ...kept, outcome: "control" }, loc).keptInParty, "", "back under control the roster line goes");
  assert.equal(heldEndView({ ...kept, outcome: "control" }, loc).leftParty, 'leftParty|{"names":"L"}', "who left still stands where it is");
});

/** A document that answers ownership as Foundry's does: `isOwner` for this seat, `testUserPermission` for a named user. */
const doc = (...owners) => ({ isOwner: owners.includes("me"), testUserPermission: (user, level) => level === "OWNER" && owners.includes(user.id) });
const handWorld = ({ docs = {}, held = {}, casters = { "Actor.c": doc("p1") } } = {}) => ({
  subject: (entry) => (entry.tokenUuid ? (docs[entry.tokenUuid] ?? null) : (held[`${entry.held.partyId}|${entry.held.actorId}`] ?? null)),
  caster: (uuid) => casters[uuid] ?? null,
});
const ownerOf = (user) => (d) => d?.testUserPermission?.(user, "OWNER") === true;

t("who is drawn the select: a seat that owns every creature the card lists, by Foundry's own test on each; creatures that are gone are not asked; with none left the caster's owner; with none listed nobody", () => {
  const flag = { ...FLAG(), summons: SUMMONS() };
  const all = handWorld({ docs: { "Scene.s1.Token.t1": doc("p1"), "Scene.s1.Token.t2": doc("p1") }, held: { "party1|member1": doc("p1") } });
  assert.equal(hand.mayPickControl(flag, { ...all, owns: ownerOf({ id: "p1" }) }), true);
  assert.equal(hand.mayPickControl(flag, { ...all, owns: ownerOf({ id: "p2" }) }), false, "a seat that owns none");
  const mixed = handWorld({ docs: { "Scene.s1.Token.t1": doc("p1"), "Scene.s1.Token.t2": doc("p2") }, held: { "party1|member1": doc("p1", "p2") } });
  assert.equal(hand.mayPickControl(flag, { ...mixed, owns: ownerOf({ id: "p1" }) }), false, "one creature it does not own is enough");
  const stashed = handWorld({ docs: { "Scene.s1.Token.t1": doc("p1"), "Scene.s1.Token.t2": doc("p1") }, held: { "party1|member1": doc("gm") } });
  assert.equal(hand.mayPickControl(flag, { ...stashed, owns: ownerOf({ id: "p1" }) }), false, "a stashed creature Foundry gives the Judge alone is the Judge's");
  assert.equal(hand.mayPickControl(flag, { ...stashed, owns: ownerOf({ id: "gm" }) }), false, "and only a seat that owns the rest too");
  const vanished = handWorld({ docs: { "Scene.s1.Token.t1": doc("p1") } });
  assert.equal(hand.mayPickControl(flag, { ...vanished, owns: ownerOf({ id: "p1" }) }), true, "creatures that no longer exist are skipped");
  const none = handWorld({ casters: { "Actor.c": doc("p1") } });
  assert.equal(hand.mayPickControl(flag, { ...none, owns: ownerOf({ id: "p1" }) }), true, "with every creature gone the caster's owner may still set the card's record");
  assert.equal(hand.mayPickControl(flag, { ...none, owns: ownerOf({ id: "p2" }) }), false);
  assert.equal(hand.mayPickControl(FLAG(), { ...all, owns: ownerOf({ id: "p1" }) }), false, "a card that lists no creature draws none, which is every card posted before the list was kept");
  assert.equal(hand.mayPickControl({ ...flag, outcome: "gone" }, { ...all, owns: ownerOf({ id: "p1" }) }), false, "after they go the creatures are deleted and the card draws none");
  const live = { ...all, entries: () => SUMMONS().slice(0, 1) };
  assert.equal(hand.mayPickControl(FLAG(), { ...live, owns: ownerOf({ id: "p1" }) }), true, "a card that keeps no list (the time-end card) reads its creatures live");
  const own = (...ids) => ({ ...all, owns: (d) => d.testUserPermission({ id: ids[0] }, "OWNER") });
  assert.equal(hand.mayPickControl({ ...flag, outcome: "stays" }, own("p1")), true, "a stay end drops no owners, so a Player who owns them gets the select");
});

/** A card element the select is drawn into, and the document that makes its parts. */
class El {
  constructor(tag) { Object.assign(this, { tag, attrs: {}, children: [], listeners: {}, className: "", textContent: "", value: "", before: null }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  get nodeType() { return 1; }
}
const cardHtml = ({ line = true } = {}) => {
  const root = new El("div");
  const foot = new El("footer");
  foot.before = (node) => root.children.push(["before-foot", node]);
  const outcomeLine = new El("p");
  outcomeLine.before = (node) => root.children.push(["in-line-place", node]);
  outcomeLine.remove = () => (outcomeLine.removed = true);
  const html = { ownerDocument: { createElement: (tag) => new El(tag) }, querySelector: (sel) => ({ ".acks-extras-cast-held": root, ".acks-extras-cast-held__foot": foot, ...(line ? { "[data-acks-extras-control-line]": outcomeLine } : {}) })[sel] ?? null };
  return { html, root, outcomeLine };
};
const drawn = (root) => root.children.find((c) => Array.isArray(c))?.[1] ?? root.children.find((c) => c?.tag === "div") ?? null;

t("the select is built when the card is bound, from the flag, so a card posted before this build draws it too; it carries an aria-label and a tooltip key and no id; a seat that owns not every creature is drawn none", () => {
  globalThis.game.user = { id: "p1", isGM: false };
  globalThis.fromUuidSync = (uuid) => ({ "Actor.c": doc("me"), "Scene.s1.Token.t1": { actor: doc("me") }, "Scene.s1.Token.t2": { actor: doc("me") } })[uuid] ?? null;
  const message = { id: "m1", flags: { "acks-extras": { castHeldEnd: { ...FLAG(), summons: SUMMONS().slice(0, 2), outcome: "stays" } } } };
  const mine = cardHtml();
  hand.bindControlSelect(message, mine.html, { key: "castHeldEnd", root: ".acks-extras-cast-held", anchor: ".acks-extras-cast-held__foot" });
  const wrap = drawn(mine.root);
  assert.ok(wrap, "a seat that owns every creature is drawn the select");
  assert.deepEqual([mine.root.children[0][0], mine.outcomeLine.removed], ["in-line-place", true], "it takes the outcome line's place, so the seat reads one of the two");
  const label = wrap.children.find((c) => c.tag === "label");
  const select = label.children.find((c) => c.tag === "select");
  assert.equal(select.attrs["aria-label"], "ACKS-MAGIC.castControl.aria");
  assert.equal(select.attrs["data-tooltip"], "ACKS-MAGIC.castControl.tip");
  assert.equal("title" in select.attrs, false, "core's tooltip manager, never a title");
  assert.equal("id" in select.attrs || "id" in label.attrs || "id" in wrap.attrs, false, "no literal id");
  assert.deepEqual(select.children.map((o) => [o.value, o.selected]), [["control", false], ["stays", true], ["gone", false], ["hostile", false]]);
  assert.equal(select.value, "stays");
  assert.equal(wrap.children.find((c) => c.tag === "p").textContent, "ACKS-MAGIC.castControl.hint.stays", "a visible hint under the select");
  const bare = cardHtml({ line: false });
  hand.bindControlSelect({ id: "m1", flags: { "acks-extras": { castHeldEnd: { ...FLAG(), summons: SUMMONS().slice(0, 2) } } } }, bare.html, { key: "castHeldEnd", root: ".acks-extras-cast-held", anchor: ".acks-extras-cast-held__foot" });
  const unrecorded = drawn(bare.root).children[0].children[1];
  assert.deepEqual([unrecorded.children[0].value, unrecorded.children[0].disabled, unrecorded.value], ["", true, ""], "an old card opens on Not recorded");
  const gone = cardHtml();
  hand.bindControlSelect({ id: "m1", flags: { "acks-extras": { castHeldEnd: { ...FLAG(), summons: SUMMONS().slice(0, 2), outcome: "gone" } } } }, gone.html, { key: "castHeldEnd", root: ".acks-extras-cast-held", anchor: ".acks-extras-cast-held__foot" });
  assert.deepEqual([drawn(gone.root), gone.outcomeLine.removed], [null, undefined], "after they go no select, and the outcome line stays");
  globalThis.fromUuidSync = (uuid) => ({ "Actor.c": doc("me"), "Scene.s1.Token.t1": { actor: doc("me") }, "Scene.s1.Token.t2": { actor: doc() } })[uuid] ?? null;
  const theirs = cardHtml();
  hand.bindControlSelect(message, theirs.html, { key: "castHeldEnd", root: ".acks-extras-cast-held", anchor: ".acks-extras-cast-held__foot" });
  assert.equal(drawn(theirs.root), null, "one creature it does not own and it is drawn no select");
  delete globalThis.game.user;
  delete globalThis.fromUuidSync;
});

/** A card message in a world of tokens, with the lib call stubbed. */
const handCard = (flagOver = {}) => {
  const log = { applied: [], updates: [] };
  const message = { id: "m1", flags: { "acks-extras": { castHeldEnd: { ...FLAG(), summons: SUMMONS(), outcome: "hostile", left: [{ name: "Invented Stashed" }], kept: [{ name: "K" }], ...flagOver } } }, update: async (patch) => log.updates.push(patch) };
  return { log, message };
};
const answerOf = (outcome, over = {}) => ({ ok: true, outcome, stamped: 1, deleted: 0, released: 0, hostile: 0, unapplied: 0, ...over });
const allMine = () => handWorld({ docs: { "Scene.s1.Token.t1": doc("p1"), "Scene.s1.Token.t2": doc("p1") }, held: { "party1|member1": doc("p1") } });

await ta("each of the four values re-applies on the GM's client through lib's control end, naming the cast and the value, and the card's record and drawn line follow", async () => {
  for (const outcome of ["control", "stays", "gone", "hostile"]) {
    const { log, message } = handCard({ outcome: outcome === "control" ? "stays" : "control" });
    const answer = await hand.setControlOnCard({
      message, key: "castHeldEnd", outcome, sender: { id: "p1" }, world: allMine(),
      apply: async (caster, req) => (log.applied.push([caster, req]), answerOf(outcome)),
      render: async (flag) => `card:${flag.outcome}`,
    });
    assert.deepEqual(log.applied.map(([, req]) => req), [{ castId: "x", outcome }], outcome);
    assert.equal(answer.ok, true);
    assert.equal(answer.outcome, outcome);
    const [patch] = log.updates;
    assert.equal(patch.content, `card:${outcome}`, `${outcome}: the drawn card is redrawn from the new record`);
    assert.equal(patch["flags.acks-extras.castHeldEnd.outcome"], outcome, `${outcome}: the record says so`);
  }
});

await ta("a value set by hand records who set it; who left the party stays recorded as having left, and what the roster kept is the card's no more than the hostile end answered", async () => {
  const back = handCard();
  await hand.setControlOnCard({ message: back.message, key: "castHeldEnd", outcome: "control", sender: { id: "p1" }, by: "Player One", world: allMine(), apply: async () => answerOf("control"), render: async () => "x" });
  const first = back.log.updates[0];
  assert.equal(first["flags.acks-extras.castHeldEnd.setBy"], "Player One");
  assert.equal("flags.acks-extras.castHeldEnd.left" in first || "flags.acks-extras.castHeldEnd.kept" in first, false, "they still stand where they went, and the view hides the roster line under control");
  const again = handCard({ outcome: "control", kept: [{ name: "K" }] });
  await hand.setControlOnCard({ message: again.message, key: "castHeldEnd", outcome: "hostile", sender: { id: "p1" }, world: allMine(), apply: async () => answerOf("hostile", { kept: [] }), render: async () => "x" });
  assert.equal(hand.isUnsetValue(again.log.updates[0]["flags.acks-extras.castHeldEnd.kept"]), true, "a hostile end that kept nobody clears the roster line");
  const goneCard = handCard({ outcome: "gone" });
  assert.deepEqual(await hand.setControlOnCard({ message: goneCard.message, key: "castHeldEnd", outcome: "control", sender: { id: "p1" }, world: allMine(), apply: async () => assert.fail("deleted creatures are not set"), render: async () => "x" }), { ok: false, reason: "gone" });
  const turn = handCard({ outcome: "stays", left: undefined, kept: undefined });
  await hand.setControlOnCard({
    message: turn.message, key: "castHeldEnd", outcome: "hostile", sender: { id: "p1" }, world: allMine(), render: async () => "x",
    apply: async () => answerOf("hostile", { hostile: 3, left: [{ partyId: "party1", actorId: "member1", name: "Invented Stashed", tokenUuid: "Scene.s9.Token.new1", deployed: false }], kept: [] }),
  });
  const patch = turn.log.updates[0];
  assert.deepEqual(patch["flags.acks-extras.castHeldEnd.left"], [{ name: "Invented Stashed" }]);
  assert.deepEqual(patch["flags.acks-extras.castHeldEnd.summons"][2], { name: "Invented Stashed", img: "icons/invented-stashed.webp", tokenUuid: "Scene.s9.Token.new1" }, "its roster row is gone, so the card names the token");
});

await ta("a seat that does not own every creature is refused on the GM's client and nothing is applied or written; a bad value and a card with no creature list are refused too", async () => {
  const log = { applied: 0 };
  const apply = async () => (log.applied++, answerOf("gone"));
  const run = (over) => {
    const card = handCard();
    return hand.setControlOnCard({ message: card.message, key: "castHeldEnd", outcome: "gone", sender: { id: "p2" }, world: allMine(), apply, render: async () => "x", ...over }).then((a) => [a, card.log.updates.length]);
  };
  assert.deepEqual(await run({}), [{ ok: false, reason: "notOwner" }, 0]);
  assert.deepEqual(await run({ outcome: "vanish", sender: { id: "p1" } }), [{ ok: false, reason: "badOutcome" }, 0]);
  const noList = handCard();
  noList.message.flags["acks-extras"].castHeldEnd.summons = [];
  assert.deepEqual(await hand.setControlOnCard({ message: noList.message, key: "castHeldEnd", outcome: "gone", sender: { id: "p1" }, world: allMine(), apply, render: async () => "x" }), { ok: false, reason: "notOwner" });
  assert.deepEqual(await hand.setControlOnCard({ message: null, key: "castHeldEnd", outcome: "gone", sender: { id: "p1" }, world: allMine(), apply, render: async () => "x" }), { ok: false, reason: "noCard" });
  assert.equal(log.applied, 0);
  const gmOwn = handCard();
  assert.equal((await hand.setControlOnCard({ message: gmOwn.message, key: "castHeldEnd", outcome: "gone", sender: null, world: handWorld({ docs: { "Scene.s1.Token.t1": doc() }, casters: { "Actor.c": doc() } }), apply, render: async () => "x" })).ok, true, "a Judge's own call, which carries no sender, owns everything");
});

await ta("creatures that no longer exist are skipped and counted; with every one gone only the card's record changes and the answer says so", async () => {
  const some = handCard();
  const answer = await hand.setControlOnCard({
    message: some.message, key: "castHeldEnd", outcome: "stays", sender: { id: "p1" }, world: handWorld({ docs: { "Scene.s1.Token.t1": doc("p1") } }), render: async () => "x",
    apply: async () => answerOf("stays"),
  });
  assert.deepEqual([answer.ok, answer.skipped, answer.none], [true, 2, false]);
  const all = handCard();
  let applied = 0;
  const empty = await hand.setControlOnCard({ message: all.message, key: "castHeldEnd", outcome: "stays", sender: { id: "p1" }, world: handWorld(), render: async () => "x", apply: async () => (applied++, answerOf("stays")) });
  assert.deepEqual([empty.ok, empty.none, empty.skipped, applied], [true, true, 3, 0], "no creature, no lib call");
  assert.equal(all.log.updates[0]["flags.acks-extras.castHeldEnd.outcome"], "stays", "the record still changes");
});

await ta("lib refusing the control end leaves the card as it was", async () => {
  const card = handCard();
  const out = await hand.setControlOnCard({ message: card.message, key: "castHeldEnd", outcome: "gone", sender: { id: "p1" }, world: allMine(), render: async () => "x", apply: async () => ({ ok: false, reason: "notGm" }) });
  assert.deepEqual(out, { ok: false, reason: "notGm" });
  assert.equal(card.log.updates.length, 0);
});

await ta("the relay op reads the card and the creatures on the GM's client and re-tests the sender's ownership there: a seat that owns the caster but not the creatures is refused; an unknown card and value are refused", async () => {
  const w = restoreWorld({ authorGM: true, owned: { p1: ["Actor.c"] } });
  w.message.flags["acks-extras"].castHeldEnd = { ...FLAG(), summons: [{ name: "Invented Wisp", img: "", tokenUuid: "Scene.s1.Token.t1" }], outcome: "hostile" };
  w.actors["Scene.s1.Token.t1"] = { actor: { testUserPermission: () => false } };
  assert.deepEqual(await magicHeldEnd({ op: "setControl", messageId: "m1", outcome: "control", requestUserId: "p1" }), { ok: false, reason: "notOwner" }, "after a hostile end the seat's ownership is gone");
  assert.deepEqual(await magicHeldEnd({ op: "setControl", messageId: "gone", outcome: "control", requestUserId: "p1" }), { ok: false, reason: "noCard" });
  assert.deepEqual(await magicHeldEnd({ op: "setControl", messageId: "m1", outcome: "vanish", requestUserId: "p1" }), { ok: false, reason: "badOutcome" });
  assert.deepEqual(await magicHeldEnd({ op: "setControl", messageId: "m1", outcome: "control", requestUserId: "nobody" }), { ok: false, reason: "noUser" });
  assert.equal(w.log.messageUpdates.length, 0);
  delete w.actors["Scene.s1.Token.t1"];
  const gone = await magicHeldEnd({ op: "setControl", messageId: "m1", outcome: "stays", requestUserId: "p1" });
  assert.deepEqual([gone.ok, gone.none, gone.skipped], [true, true, 1], "the owner of the caster sets the record of a card whose creatures are all gone");
  assert.equal(w.log.messageUpdates.length, 1);
  assert.ok(w.log.messageUpdates[0].content.includes("controlLost.stays"), "the card is redrawn through the card's own template");
  restoreWorldDown();
});

await ta("a pick goes to the GM's client as {op: \"setControl\", messageId, outcome} and nothing else (a Judge's own seat is that client); a refusal and a card with no creature left are told to the presser", async () => {
  const sent = [];
  const told = [];
  let reply;
  const deps = { relay: async (payload) => (sent.push(payload), reply), warn: (text) => told.push(["warn", text]), info: (text) => told.push(["info", text]) };
  const message = { id: "m1" };
  reply = { ok: true, outcome: "gone", skipped: 0, none: false };
  await hand.pressControl(message, "gone", deps);
  assert.deepEqual(sent, [{ op: "setControl", messageId: "m1", outcome: "gone" }], "the seat names the card and the value and claims nothing else");
  assert.deepEqual(told, []);
  reply = { ok: false, reason: "notOwner" };
  assert.equal((await hand.pressControl(message, "control", deps)).ok, false);
  assert.deepEqual(told.map((x) => x[0]), ["warn"]);
  reply = { ok: true, outcome: "stays", skipped: 2, none: true };
  await hand.pressControl(message, "stays", deps);
  assert.deepEqual(told.slice(1).map((x) => x[0]), ["info"], "the none-left answer is a notice");
  reply = { ok: true, outcome: "stays", skipped: 1, none: false };
  await hand.pressControl(message, "stays", deps);
  assert.deepEqual(told.slice(2).map((x) => x[0]), ["info"], "a skip is a notice");
  reply = null;
  assert.equal(await hand.pressControl(message, "stays", deps), null, "with no GM connected nothing is told twice");
  assert.equal(told.length, 3);
});

console.log(`\n${n} cast-held tests passed`);
