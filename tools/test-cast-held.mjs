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
  utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) },
  applications: { handlebars: { renderTemplate: async (path, view) => (path.endsWith("cast-held-card.hbs") ? CARD(view) : "") } },
};
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };

const { heldStatusOf, heldRecordData, causeOf, heldEndPlan, checkHeldEndRequest, restorePlan, restoredAs, runHeldPlan, endHeldCast, heldEndContent, heldEndView, controlLostLine, pressDismiss, bindCard, HELD_CAUSES } = await import("../scripts/magic/cast-held.mjs");
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
  assert.equal(data.system, undefined, "a held record holds the one status of its kind and no figure");
  assert.throws(() => spellEffectData({ ...MARK, startTime: 40, statuses: ["concentratingStationary", "other"], held: "stationary" }), /exactly what the builder returned/);
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

await ta("on a seat, Dismiss and Dismiss all are kept for a GM seat alone, whoever owns the caster; Restore follows the same seat, and the lib dismissal is what decides who may remove", async () => {
  const html0 = await heldEndContent({ ...FLAG(), summons: SUMMONS() }, loc);
  const asked = [];
  const button = (attrs = {}) => ({ removed: false, listeners: 0, dataset: attrs, remove() { this.removed = true; }, addEventListener() { this.listeners += 1; } });
  const seat = (isGM, owner) => {
    globalThis.game.user = { isGM };
    globalThis.fromUuidSync = () => ({ isOwner: owner });
    const dismiss = [button({ tokenUuid: "a" }), button({ tokenUuid: "b" }), button({ partyId: "p", memberId: "m" }), button({ all: "1" })];
    const restore = button();
    const end = button({ actorUuid: "Actor.c2" });
    const foot = { removed: false, children: isGM ? [{}, {}] : [], remove() { this.removed = true; } };
    const message = { flags: { "acks-extras": { castHeldEnd: { ...FLAG(), summons: SUMMONS() } } } };
    const html = {
      querySelectorAll: (sel) => (asked.push(sel), sel.includes("dismiss") ? dismiss : sel.includes("restore") ? [restore] : [end]),
      querySelector: () => foot,
    };
    bindCard(message, html);
    return { dismiss, restore, end, foot };
  };
  const gm = seat(true, false);
  assert.deepEqual(gm.dismiss.map((d) => [d.removed, d.listeners]), [[false, 1], [false, 1], [false, 1], [false, 1]], "a GM seat keeps every Dismiss and wires it");
  assert.equal(gm.foot.removed, false);
  const owner = seat(false, true);
  assert.deepEqual(owner.dismiss.map((d) => [d.removed, d.listeners]), [[true, 0], [true, 0], [true, 0], [true, 0]], "an owner's seat is not a GM's: every Dismiss is removed");
  assert.deepEqual([owner.restore.removed, owner.end.removed], [true, false], "End keeps its own owner test, which Dismiss does not copy");
  assert.equal(owner.foot.removed, true, "the footer Restore and Dismiss all left is taken away empty");
  const other = seat(false, false);
  assert.ok(other.dismiss.every((d) => d.removed));
  assert.ok(asked.includes("[data-acks-extras-held-dismiss]"), "the hook asks for the attribute the template draws");
  for (const attr of ["data-acks-extras-held-dismiss", "data-acks-extras-held-restore", "data-acks-extras-held-end"]) assert.ok(html0.includes(attr), `the template draws ${attr}`);
  delete globalThis.game.user;
  delete globalThis.fromUuidSync;
});

console.log(`\n${n} cast-held tests passed`);
