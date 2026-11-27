/**
 * Offline tests for the blood sacrifice (`scripts/magic/sacrifice.mjs`): who counts, the gates and their
 * severities, the yield and when it holds, the throw, the trait sum on a success against nothing on a failure, and
 * the act's order of writes. The window's markup and strings are checked at the foot. Every figure, name and page
 * below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-sacrifice.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

/** What the live half reads and writes: the seat's user, the documents by uuid, and every request sent toward the GM. */
const world = { isGM: true, activeGM: true, docs: new Map(), emitted: [], posted: [] };
const hooked = [];
globalThis.Hooks = { on: (name, fn) => hooked.push([name, fn]), once() {} };
globalThis.foundry = { utils: { randomID: () => "id", escapeHTML: (s) => String(s) }, data: { operators: { ForcedDeletion: class ForcedDeletion {} } } };
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.game = {
  i18n: { format: (key) => key, localize: (key) => key },
  get user() {
    return { id: world.isGM ? "gm1" : "pl1", isGM: world.isGM };
  },
  users: { get: (id) => ({ id, isGM: id === "gm1" }), get activeGM() { return world.activeGM ? { id: "gm1" } : null; } },
  time: { worldTime: 0, calendar: null },
  actors: { filter: () => [] },
  socket: { emit: (_channel, message) => world.emitted.push(message) },
};
globalThis.fromUuidSync = (uuid) => world.docs.get(uuid) ?? null;
globalThis.fromUuid = async (uuid) => world.docs.get(uuid) ?? null;

const S = await import("../scripts/magic/sacrifice.mjs");
const L = await import("../scripts/magic/sacrifice-live.mjs");

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

/** A localizer that echoes the key and its data, so a test reads what a string was asked for. */
const echo = (key, data) => (data && Object.keys(data).length ? `${key}${JSON.stringify(data)}` : key);

/* ------------------------------ invented tables ------------------------------ */

const TABLES = {
  ladder: { present: true, rungs: [{ level: 4, rate: 30, throw: 15, marked: false }], otherProjectsRate: null, markedProjects: null, cite: "Invented p. 2", byHand: false },
  prose: { present: true, autoFail: { min: 1, max: 1 }, ancillary: null, penalty: null, penaltyMinimum: null, cite: "Invented p. 6", byHand: false },
  sacrifice: { present: true, rows: [{ label: "Trait A", times: 4 }, { label: "Trait B", times: 7 }, { label: "Trait C", times: null }], cite: "Invented p. 3", byHand: false },
  powerOfSacrifice: { present: true, multiplier: 6, cite: "Invented p. 4", byHand: false },
};
const NOTHING = {
  ladder: { present: false, rungs: [], otherProjectsRate: null, markedProjects: null, cite: null, byHand: false },
  prose: { present: false, autoFail: null, cite: null, byHand: false },
  sacrifice: { present: false, rows: [], cite: null, byHand: false },
  powerOfSacrifice: { present: false, multiplier: null, cite: null, byHand: false },
};

const CASTER = { uuid: "Actor.c", name: "Caster", img: "", alignment: "chaotic", divine: true, level: 4, intBonus: 1 };
const value = (gp) => ({ gp, source: "xp", cite: "Invented p. 5", basis: { xp: gp } });
const victim = (uuid, o = {}) => ({ uuid, name: `Victim ${uuid}`, img: "", kind: "actor", alignment: "lawful", sapient: true, dead: false, isMonster: false, value: value(100), ...o });
const WILLING = { willing: true };
const HELPLESS = { helpless: true };
const state = (o = {}) => ({ site: true, power: false, victims: {}, ...o });
const plan = (o = {}) => S.planOf({ caster: CASTER, victims: [victim("A")], state: state({ victims: { A: HELPLESS } }), tables: TABLES, judge: false, loc: echo, ...o });
const keys = (p) => p.verdicts.map((v) => `${v.key}:${v.severity}`);

/* ------------------------------ the caster and the victim ------------------------------ */

t("the caster's basis: the class power makes it arcane, a divine caster divine, anything else none", () => {
  assert.equal(S.casterBasis({ divine: true }), "divine");
  assert.equal(S.casterBasis({ divine: true, power: true }), "arcane", "the Judge's mark of the class power takes the arcane ledger");
  assert.equal(S.casterBasis({ power: true }), "arcane");
  assert.equal(S.casterBasis({}), null);
});

t("sapience: a character is, `sapient` is, any other word is not, blank is unread", () => {
  assert.equal(S.sapientOf({ isCharacter: true }), true);
  assert.equal(S.sapientOf({ intelligence: "sapient" }), true);
  assert.equal(S.sapientOf({ intelligence: "bestial" }), false);
  assert.equal(S.sapientOf({ intelligence: "semiSapient" }), false);
  assert.equal(S.sapientOf({ intelligence: "" }), null);
  assert.equal(S.sapientOf({}), null);
});

t("a state is cleaned: toggles are booleans, traits a sorted set of indexes, a value a figure or null", () => {
  assert.deepEqual(S.cleanState({ willing: 1, helpless: true, traits: ["2", 0, 0, -1, "x", 1.5], value: "" }), { willing: false, helpless: true, young: false, traits: [0, 2], value: null });
  assert.deepEqual(S.cleanState(null), { willing: false, helpless: false, young: false, traits: [], value: null });
  assert.equal(S.cleanState({ value: "40" }).value, 40);
});

t("a lawful or neutral victim counts, and is flagged where it is not helpless; a chaotic one counts only willing", () => {
  const stand = (v, st, caster = CASTER) => S.victimStanding(v, st, { caster });
  assert.equal(stand(victim("A"), HELPLESS).counts, true);
  assert.deepEqual(stand(victim("A"), HELPLESS).findings, []);
  assert.deepEqual(stand(victim("A"), {}).findings.map((f) => f.key), ["notHelpless"]);
  assert.equal(stand(victim("A", { alignment: "neutral" }), {}).findings[0].key, "notHelpless");
  const chaotic = victim("B", { alignment: "chaotic" });
  assert.equal(stand(chaotic, WILLING).counts, true);
  assert.deepEqual(stand(chaotic, WILLING).findings, []);
  const unwilling = stand(chaotic, {});
  assert.equal(unwilling.counts, false);
  assert.equal(unwilling.reason, "unwilling");
  assert.deepEqual(unwilling.findings, [], "an unwilling chaotic victim yields nothing and raises no finding");
});

t("a dead victim, a barred creature and an unread alignment count for nothing", () => {
  assert.deepEqual([S.victimStanding(victim("A", { dead: true }), HELPLESS, { caster: CASTER }).reason, S.victimStanding(victim("A", { dead: true }), HELPLESS, { caster: CASTER }).counts], ["dead", false]);
  const barred = S.victimStanding(victim("A", { value: { gp: 0, source: "excluded", reason: "animal", cite: null } }), HELPLESS, { caster: CASTER });
  assert.deepEqual([barred.counts, barred.reason], [false, "animal"]);
  const unread = S.victimStanding(victim("A", { alignment: null }), HELPLESS, { caster: CASTER });
  assert.deepEqual([unread.counts, unread.reason, unread.holds], [false, "alignment", ["victimAlignment"]]);
});

t("a lawful or neutral caster: a sapient victim is refused, an animal is a Judge's warning, an unread intelligence holds", () => {
  const lawful = { ...CASTER, alignment: "lawful" };
  const stand = (v) => S.victimStanding(v, HELPLESS, { caster: lawful });
  assert.deepEqual(stand(victim("A", { sapient: true })).findings.map((f) => f.key), ["sapientRefused"]);
  const animal = stand(victim("A", { sapient: false }));
  assert.deepEqual(animal.findings.map((f) => [f.key, f.severity]), [["animalWarn", "warn"]]);
  assert.deepEqual(stand(victim("A", { sapient: null })).holds, ["intelligence"]);
  assert.deepEqual(S.victimStanding(victim("A", { sapient: true }), HELPLESS, { caster: CASTER }).findings, [], "a chaotic caster is never limited by sapience");
});

/* ------------------------------ the gates ------------------------------ */

t("every limit blocks a Player and warns a Judge, through the cast plan's severities", () => {
  const cases = [
    ["noSite", { state: state({ site: false, victims: { A: HELPLESS } }) }],
    ["notHelpless", { state: state({ victims: { A: {} } }) }],
    ["noBasis", { caster: { ...CASTER, divine: false } }],
    ["sapientRefused", { caster: { ...CASTER, alignment: "neutral" } }],
  ];
  for (const [key, over] of cases) {
    assert.deepEqual(keys(plan({ ...over, judge: false })), [`${key}:block`], `${key} blocks a Player`);
    assert.equal(plan({ ...over, judge: false }).canAct, false);
    assert.deepEqual(keys(plan({ ...over, judge: true })), [`${key}:warn`], `${key} warns a Judge`);
    assert.equal(plan({ ...over, judge: true }).canAct, true, `a warned Judge may go on`);
  }
  assert.deepEqual(keys(plan()), [], "no limit, no verdict");
  assert.equal(plan().canAct, true);
});

t("a verdict carries its own words, named for the victim it is about", () => {
  const p = plan({ state: state({ victims: { A: {} } }) });
  assert.equal(p.verdicts[0].notice, `finding.notHelpless${JSON.stringify({ name: "Victim A" })}`);
});

t("an unwilling chaotic victim is not blocked: it yields nothing", () => {
  const p = plan({ victims: [victim("B", { alignment: "chaotic" })], state: state({ victims: { B: {} } }) });
  assert.deepEqual(keys(p), []);
  assert.equal(p.counted, 0);
  assert.equal(p.canAct, true);
  assert.equal(p.yielded.now, 0, "nothing counted is a real zero, not an unread figure");
});

t("a lawful or neutral caster's animal sacrifice is a Judge's warning and no Player's block", () => {
  const over = { caster: { ...CASTER, alignment: "neutral" }, victims: [victim("A", { sapient: false })] };
  assert.deepEqual(keys(plan({ ...over, judge: true })), ["animalWarn:warn"]);
  assert.deepEqual(keys(plan({ ...over, judge: false })), [], "a Player is shown nothing and is not stopped");
  assert.equal(plan({ ...over, judge: false }).canAct, true);
});

/* ------------------------------ the yield ------------------------------ */

t("the yield is the counted victims' values summed, and an unwilling victim adds nothing", () => {
  const p = plan({ victims: [victim("A"), victim("B", { alignment: "chaotic", value: value(40) }), victim("C", { alignment: "chaotic", value: value(7) })], state: state({ victims: { A: HELPLESS, B: WILLING, C: {} } }) });
  assert.equal(p.yielded.base, 140);
  assert.equal(p.yielded.now, 140);
  assert.equal(p.counted, 2);
});

t("an unread victim value holds the yield, and a zero is never put in its place", () => {
  const p = plan({ victims: [victim("A"), victim("B", { value: { gp: null, source: "unimported", cite: "Invented p. 5" } })], state: state({ victims: { A: HELPLESS, B: HELPLESS } }) });
  assert.equal(p.yielded.base, null);
  assert.equal(p.yielded.now, null);
  assert.deepEqual(p.hold, { ok: false, why: "values" });
  assert.equal(p.canAct, false, "a Judge is held by a missing figure as a Player is");
  assert.equal(plan({ judge: true, victims: p.rows.map((r) => r), state: state({ victims: { A: HELPLESS, B: HELPLESS } }) }).hold.why, "values");
});

t("a Judge's hand-set value stands in for an unread one, marked as edited", () => {
  const blank = victim("A", { value: { gp: null, source: "unimported", cite: "Invented p. 5" } });
  const p = plan({ victims: [blank], state: state({ victims: { A: { helpless: true, value: 30 } } }), judge: true });
  assert.equal(p.yielded.now, 30);
  assert.equal(p.rows[0].value.source, "edited");
  assert.equal(p.rows[0].value.cite, "Invented p. 5", "the page the figure would have been read from is kept");
  assert.equal(p.hold.ok, true);
});

t("the trait bonus is the value times each ticked row's factor, zero where none is ticked, and null while a ticked factor is unread", () => {
  const withTraits = (traits) => plan({ state: state({ victims: { A: { helpless: true, traits } } }) });
  assert.equal(withTraits([]).yielded.traits, 0);
  assert.equal(withTraits([0]).yielded.traits, 400);
  assert.equal(withTraits([0, 1]).yielded.traits, 1100);
  assert.equal(withTraits([2]).yielded.traits, null, "a ticked row whose factor is not read is not counted as zero");
  assert.deepEqual(withTraits([2]).hold, { ok: false, why: "traits" });
});

t("an arcane basis counts the yield, base and traits alike, through the imported multiple; an unread multiple holds", () => {
  const arcane = plan({ caster: { ...CASTER, divine: false }, state: state({ power: true, victims: { A: { helpless: true, traits: [0] } } }) });
  assert.equal(arcane.basis, "arcane");
  assert.equal(arcane.yielded.multiplier, 6);
  assert.equal(arcane.yielded.now, 600);
  assert.equal(arcane.yielded.onSuccess, 2400);
  const unread = plan({ caster: { ...CASTER, divine: false }, tables: { ...TABLES, powerOfSacrifice: NOTHING.powerOfSacrifice }, state: state({ power: true, victims: { A: HELPLESS } }) });
  assert.equal(unread.yielded.now, null);
  assert.deepEqual(unread.hold, { ok: false, why: "multiplier" });
  assert.equal(plan({ tables: { ...TABLES, powerOfSacrifice: NOTHING.powerOfSacrifice } }).hold.ok, true, "a divine basis needs no multiple");
});

/* ------------------------------ the throw and its holds ------------------------------ */

t("the throw is a research throw with no level of effect and no facility: the ladder's rung, the Intellect bonus", () => {
  const th = S.sacrificeThrow(TABLES, { level: 4, intBonus: 2 });
  assert.equal(th.target, 15);
  assert.equal(th.levelRaise, 0);
  assert.equal(th.bonus, 0);
  assert.equal(th.int, 2);
  assert.equal(th.modifier, 2);
  assert.equal(th.noThrow, null);
});

t("no ladder, no level or no Intellect bonus holds the throw; with nothing counted no throw is asked for", () => {
  assert.deepEqual(plan({ tables: NOTHING }).hold, { ok: false, why: "throw" });
  assert.deepEqual(plan({ caster: { ...CASTER, level: null } }).hold, { ok: false, why: "throw" });
  assert.deepEqual(plan({ caster: { ...CASTER, intBonus: null } }).hold, { ok: false, why: "int" });
  assert.deepEqual(plan({ caster: { ...CASTER, alignment: null } }).hold, { ok: false, why: "casterAlignment" });
  assert.deepEqual(plan({ victims: [] }).hold, { ok: false, why: "victims" });
  const idle = plan({ tables: NOTHING, victims: [victim("B", { alignment: "chaotic" })], state: state({ victims: { B: {} } }) });
  assert.deepEqual(idle.hold, { ok: true, why: "" });
});

/* ------------------------------ the act ------------------------------ */

/** Dependencies that record what is called and in which order. */
function recorder({ die = 14, marked = null } = {}) {
  const calls = [];
  return {
    calls,
    roll: async () => (calls.push("roll"), { die }),
    mark: async (uuids) => (calls.push(`mark:${uuids.join(",")}`), { marked: marked ?? uuids, failed: uuids.filter((u) => marked && !marked.includes(u)) }),
    gain: async (kind, amount) => (calls.push(`gain:${kind}:${amount}`), { ok: true }),
    card: async (result) => calls.push(`card:${result.outcome ?? "none"}`),
  };
}
const act = (over, deps, ctx = {}) => S.performSacrifice(plan(over), deps, { tables: ctx.tables ?? TABLES });
const ticked = state({ victims: { A: { helpless: true, traits: [0, 1] } } });

await ta("a success adds the ticked traits to the base yield: 100 + (4 + 7) x 100", async () => {
  const deps = recorder({ die: 14 });
  const r = await act({ state: ticked }, deps);
  assert.equal(r.outcome, "success");
  assert.equal(r.total, 15);
  assert.equal(r.amount, 1200);
  assert.deepEqual(r.gain, { ok: true });
  assert.deepEqual(deps.calls, ["roll", "mark:A", "gain:divine:1200", "card:success"], "the throw, the victim marked, the power gained, the card");
});

await ta("a failure gives the base yield and nothing of the traits", async () => {
  const deps = recorder({ die: 13 });
  const r = await act({ state: ticked }, deps);
  assert.equal(r.outcome, "failure");
  assert.equal(r.amount, 100);
  assert.deepEqual(deps.calls, ["roll", "mark:A", "gain:divine:100", "card:failure"], "the victim is marked on a failure too");
});

await ta("a die in the automatic-failure band fails even where the total reaches the target", async () => {
  const deps = recorder({ die: 1 });
  const r = await act({ caster: { ...CASTER, intBonus: 30 }, state: ticked }, deps);
  assert.equal(r.auto, true);
  assert.ok(r.total >= r.target);
  assert.equal(r.outcome, "failure");
  assert.equal(r.amount, 100);
});

await ta("the power is gained for the victims that were marked, and for no others", async () => {
  const deps = recorder({ die: 14, marked: ["B"] });
  const victims = [victim("A"), victim("B", { value: value(40) })];
  const r = await act({ victims, state: state({ victims: { A: HELPLESS, B: HELPLESS } }) }, deps);
  assert.deepEqual(r.marked, ["B"]);
  assert.deepEqual(r.failed, ["A"]);
  assert.equal(r.amount, 40);
  assert.ok(deps.calls.indexOf("mark:A,B") < deps.calls.findIndex((c) => c.startsWith("gain")), "marked before gained");
});

await ta("a victim that was marked nowhere yields no gain at all", async () => {
  const deps = recorder({ marked: [] });
  const r = await act({}, deps);
  assert.equal(r.amount, 0);
  assert.equal(r.gain, null);
  assert.ok(!deps.calls.some((c) => c.startsWith("gain")));
});

await ta("an arcane basis gains arcane power through the multiple", async () => {
  const deps = recorder({ die: 14 });
  const r = await act({ caster: { ...CASTER, divine: false }, state: state({ power: true, victims: { A: { helpless: true, traits: [0] } } }) }, deps);
  assert.equal(r.kind, "arcane");
  assert.equal(r.amount, 3000);
  assert.ok(deps.calls.includes("gain:arcane:3000"));
});

await ta("an unwilling chaotic victim is neither marked nor yields, and with no other victim no throw is made", async () => {
  const deps = recorder();
  const r = await act({ victims: [victim("B", { alignment: "chaotic" })], state: state({ victims: { B: {} } }) }, deps);
  assert.equal(r.nothing, true);
  assert.equal(r.amount, 0);
  assert.deepEqual(deps.calls, ["card:none"], "no roll, no mark, no gain");
});

await ta("an unwilling chaotic victim beside a counted one stays unmarked", async () => {
  const deps = recorder({ die: 14 });
  const r = await act({ victims: [victim("A"), victim("B", { alignment: "chaotic", value: value(500) })], state: state({ victims: { A: HELPLESS, B: {} } }) }, deps);
  assert.deepEqual(r.marked, ["A"]);
  assert.equal(r.amount, 100);
});

await ta("a held or blocked plan is refused and nothing is rolled, marked or gained", async () => {
  for (const [over, reason] of [[{ tables: NOTHING }, "throw"], [{ state: state({ site: false, victims: { A: HELPLESS } }) }, "blocked"], [{ victims: [] }, "victims"]]) {
    const deps = recorder();
    const r = await act(over, deps, { tables: over.tables ?? TABLES });
    assert.deepEqual([r.ok, r.reason], [false, reason]);
    assert.deepEqual(deps.calls, []);
  }
});

await ta("a Judge warned by a limit goes on and the act is made", async () => {
  const deps = recorder({ die: 14 });
  const r = await act({ judge: true, state: state({ site: false, victims: { A: HELPLESS } }) }, deps);
  assert.equal(r.ok, true);
  assert.equal(r.amount, 100);
});

/* ------------------------------ the GM's half of a Player's mark ------------------------------ */

t("the GM's client marks for a Judge or the caster's owner, and only creatures it can read that are not dead", () => {
  const resolved = [{ uuid: "A", creature: true, dead: false }, { uuid: "D", creature: true, dead: true }, { uuid: "X", creature: false, dead: false }];
  const ask = (req, o = {}) => S.checkMarkRequest({ casterUuid: "C", ...req }, { caster: { uuid: "C" }, fromJudge: false, owns: true, resolved, ...o });
  assert.deepEqual(ask({ uuids: ["A"] }), { ok: true });
  assert.deepEqual(ask({ uuids: ["A"] }, { owns: false }), { refused: "owner" });
  assert.deepEqual(ask({ uuids: ["A"] }, { owns: false, fromJudge: true }), { ok: true });
  assert.deepEqual(ask({ uuids: ["A"] }, { caster: null }), { refused: "noCaster" });
  assert.deepEqual(ask({ uuids: [] }), { refused: "noVictims" });
  assert.deepEqual(ask({ uuids: ["A", "D"] }), { refused: "dead" });
  assert.deepEqual(ask({ uuids: ["X"] }), { refused: "victim" });
  assert.deepEqual(ask({ uuids: ["Q"] }), { refused: "victim" }, "a uuid the GM cannot read is no victim");
  assert.deepEqual(ask({ uuids: ["C"] }, { resolved: [{ uuid: "C", creature: true, dead: false }] }), { refused: "self" });
});

/* ------------------------------ the window's model ------------------------------ */

const PARTIAL = "modules/acks-extras/templates/magic/sacrifice-victim.hbs";
const panel = (over = {}) => S.panelModel({ caster: CASTER, victims: [victim("A")], state: state({ victims: { A: { helpless: true, traits: [0] } } }), tables: TABLES, judge: true, editable: true, loc: echo, bucketLoc: echo, cites: { sacrifice: "Invented p. 3", value: "Invented p. 5" }, rowPartial: PARTIAL, ...over });
/** A seat that cannot edit the caster: severity as a Player, permission off. */
const readOnly = (over = {}) => panel({ judge: false, editable: false, ...over });
/** A Player who owns the caster: severity as a Player, permission on. */
const owning = (over = {}) => panel({ judge: false, editable: true, ...over });
const extraOf = (p, i = 0) => p.bucket.rows[i].extra;

t("the bucket's rows are the victims, each with its value; the checks ride inside each row, as an owner's controls or a read-only seat's text", () => {
  const judge = panel();
  assert.equal(judge.bucket.rows.length, 1);
  assert.equal(judge.bucket.rows[0].valueText.length > 0, true);
  assert.equal(judge.bucket.head, null, "the bucket's own total is replaced by the yield lines");
  assert.equal("states" in judge, false, "no section of victim states under the bucket");
  const e = extraOf(judge);
  assert.equal(e.partial, PARTIAL);
  assert.equal(e.editable, true);
  assert.equal("judge" in e, false, "the row's flag is permission, and severity is not in it");
  assert.deepEqual(e.checks.map((c) => [c.field, c.checked]), [["helpless", true]]);
  assert.deepEqual(e.traits.map((x) => [x.index, x.checked]), [[0, true], [1, false], [2, false]]);
  assert.notEqual(e.value, null, "an owner may set a value");
  assert.equal(e.said, undefined);
  assert.equal(judge.site.disabled, false);
  const player = readOnly();
  const q = extraOf(player);
  assert.equal(q.editable, false);
  assert.equal(q.said, "helpless · Trait A", "the set checks as text, in the order drawn");
  assert.equal(q.value, undefined, "a seat that cannot edit is given no value box; the row's own value line is its text");
  assert.equal(q.young, undefined);
  assert.equal(player.site.disabled, true);
  assert.equal(player.power.shown, false, "the class-power check is an owner's, and a seat that cannot edit sees it only where it is ticked");
  assert.equal(readOnly({ state: state({ power: true, victims: { A: HELPLESS } }) }).power.shown, true);
  assert.equal(readOnly({ state: state({ power: true, victims: { A: HELPLESS } }) }).power.disabled, true);
  assert.equal(judge.power.shown, true);
});

t("a Player who owns the caster edits: the checks, the value box and young are drawn, site and power are enabled, and nothing waits; severity still reads the role", () => {
  const model = owning({ victims: [victim("A", { alignment: "chaotic", isMonster: true })], state: state({ site: false, victims: { A: {} } }) });
  const e = extraOf(model);
  assert.equal(e.editable, true);
  assert.deepEqual(e.checks.map((c) => c.field), ["willing"]);
  assert.equal(e.traits.length, 3, "the imported trait rows are drawn as controls");
  assert.notEqual(e.value, null, "the value box is drawn");
  assert.equal(e.young.label, "young", "young is drawn for a creature");
  assert.equal(e.said, undefined, "no read-only text beside the controls");
  assert.equal(model.site.disabled, false);
  assert.equal(model.power.disabled, false);
  assert.equal(model.power.shown, true, "the class-power check is drawn though nothing ticked it");
  assert.equal(model.lines.some((l) => l.severity === "wait"), false, "no waiting line");
  assert.equal(model.lines.some((l) => /^waiting/.test(l.text)), false);
  assert.deepEqual(model.lines.map((l) => l.severity), ["block"], "the missing site blocks a Player, as it reads the role");
  assert.equal(model.blocked, true);
  const set = owning({ state: state({ site: true, victims: { A: HELPLESS } }) });
  assert.deepEqual([set.blocked, set.lines.length], [false, 0], "once the checks are set nothing stands in the way");
});

t("a seat that cannot edit reads text, is told what waits, and has site and power disabled, whatever its role", () => {
  for (const judge of [false, true]) {
    const model = panel({ judge, editable: false, state: state({ site: false, victims: { A: { helpless: true } } }) });
    const e = extraOf(model);
    assert.equal(e.said, "helpless", `judge ${judge}: the set checks as text`);
    assert.equal(e.value, undefined);
    assert.equal(e.young, undefined);
    assert.equal(model.site.disabled, true);
    assert.equal(model.power.disabled, true);
    assert.equal(model.power.shown, false);
    assert.deepEqual(model.lines.map((l) => l.severity), ["wait"], "one waiting line");
    assert.match(model.why, /^waiting\{/);
  }
});

t("with no row partial named no row carries a slot", () => {
  assert.equal("extra" in panel({ rowPartial: "" }).bucket.rows[0], false);
});

t("the willing check belongs to a chaotic victim and the helpless one to the others; an unread alignment has neither; young is a creature's", () => {
  const fields = (a) => extraOf(panel({ victims: [victim("A", { alignment: a })] })).checks.map((c) => c.field);
  assert.deepEqual(fields("chaotic"), ["willing"]);
  assert.deepEqual(fields("lawful"), ["helpless"]);
  assert.deepEqual(fields("neutral"), ["helpless"]);
  assert.deepEqual(fields(null), []);
  assert.equal(extraOf(panel({ victims: [victim("A", { isMonster: true })] })).young.label, "young");
  assert.equal(extraOf(panel()).young, null, "a character is no creature the young bar applies to");
});

t("a hand-set value is edited, and its tooltip names the figure it replaced, or says none was read, with the page", () => {
  const set = (value, v = victim("A")) => extraOf(panel({ victims: [v], state: state({ victims: { A: { helpless: true, value } } }) })).value;
  assert.deepEqual([set(null).edited, set(null).shown], [false, ""]);
  assert.match(set(null).tip, /valueBoxTip.*Invented p. 5/, "a blank box says what it does");
  const hand = set(250);
  assert.deepEqual([hand.edited, hand.shown], [true, "250"]);
  assert.match(hand.tip, /valueBoxWas.*"was":100.*Invented p. 5/, "the replaced figure and the page");
  const none = set(250, victim("A", { value: { gp: null, source: "none", cite: "Invented p. 8" } }));
  assert.match(none.tip, /valueBoxNoneRead.*Invented p. 8/, "no value was read, and the page says where it is printed");
});

t("a Player's row reads a creature's young mark and a ticked trait as text beside the checks", () => {
  const p = readOnly({victims: [victim("A", { alignment: "chaotic", isMonster: true })], state: state({ victims: { A: { willing: true, young: true, traits: [1] } } }) });
  assert.equal(extraOf(p).said, "willing · Trait B · young");
  assert.equal(extraOf(readOnly({state: state({ victims: { A: {} } }) })).said, "", "nothing set reads as nothing");
});

t("with no trait table imported no trait check is drawn and the bonus line is blank", () => {
  const p = panel({ tables: { ...TABLES, sacrifice: NOTHING.sacrifice } });
  assert.equal(extraOf(p).traits.length, 0);
  assert.equal(p.yield.bonus.text, "");
  assert.equal(panel().yield.bonus.text, "400");
});

t("the yield lines: the figure now, the bonus on a success, each with where it came from", () => {
  const p = panel();
  assert.equal(p.yield.now.text, "100");
  assert.equal(p.yield.bonus.text, "400");
  assert.match(p.yield.now.tip, /yield\.nowTip/);
  assert.match(p.yield.now.tip, /Victim A 100/);
  assert.match(p.yield.bonus.tip, /Invented p\. 3/);
  assert.equal(p.yield.unit, "divine");
});

t("a Player waits on the Judge for what a Judge's check settles, in one footer line; a Judge's is enabled with the warning", () => {
  const over = { state: state({ site: false, victims: { A: {} } }) };
  const player = readOnly(over);
  assert.equal(player.blocked, true, "the Sacrifice button stays disabled");
  assert.deepEqual(player.lines.map((l) => l.severity), ["wait"]);
  assert.equal(player.why, 'waiting{"what":"wait.noSite{\\"name\\":\\"\\"}; wait.notHelpless{\\"name\\":\\"Victim A\\"}"}', "the site and the victim, said once");
  const judge = panel({ ...over, judge: true });
  assert.equal(judge.blocked, false);
  assert.deepEqual(judge.lines.map((l) => l.severity), ["warn", "warn"], "a Judge reads each limit as it stands");
  const done = readOnly({state: state({ site: true, victims: { A: HELPLESS } }) });
  assert.deepEqual([done.blocked, done.lines.length], [false, 0], "once the Judge has set both, nothing waits and the button is free");
});

t("a limit no check of a Judge settles is a block, not a wait, and a victim's value the Judge must enter is a wait", () => {
  const refused = readOnly({caster: { ...CASTER, alignment: "lawful" }, state: state({ victims: { A: HELPLESS } }) });
  assert.deepEqual(refused.lines.map((l) => l.severity), ["block"], "a refused victim is the rules' limit, not the Judge's to set");
  const blank = readOnly({victims: [victim("A", { value: { gp: null, source: "none", cite: "Invented p. 8" } })], state: state({ victims: { A: HELPLESS } }) });
  assert.deepEqual(blank.lines.map((l) => l.severity), ["wait"]);
  assert.match(blank.why, /wait\.values/);
  assert.equal(blank.blocked, true);
  const none = readOnly({state: state({ victims: {} }), victims: [] });
  assert.deepEqual(none.lines.map((l) => l.severity), ["block"], "no victim dropped is the Player's own to fix");
});

t("a held figure is a footer line for everyone, worded with the page its figure is read from", () => {
  const p = panel({ tables: { ...TABLES, ladder: NOTHING.ladder } });
  assert.equal(p.blocked, true);
  assert.equal(p.lines.at(-1).text.startsWith("hold.throw"), true);
  const m = panel({ caster: { ...CASTER, divine: false }, state: state({ power: true, victims: { A: HELPLESS } }), tables: { ...TABLES, powerOfSacrifice: { ...NOTHING.powerOfSacrifice, cite: "Invented p. 4" } } });
  assert.match(m.lines.at(-1).text, /hold\.multiplier.*Invented p\. 4/);
});

t("a row that counts for nothing is dimmed with its reason and a chip; a sapient victim carries a chip", () => {
  const p = panel({ victims: [victim("B", { alignment: "chaotic" })], state: state({ victims: { B: {} } }) });
  assert.equal(p.bucket.rows[0].off, true);
  assert.equal(p.bucket.rows[0].reason, "noYield.unwilling");
  assert.equal(p.bucket.rows[0].chips.some((c) => c.text === "noYieldChip"), true);
  assert.equal(panel().bucket.rows[0].chips.some((c) => c.text === "sapient"), true);
});

/* ------------------------------ the live half ------------------------------ */

/** A creature document of the world: an actor that records the dead marks written to it. */
function creature(uuid, o = {}) {
  const actor = {
    documentName: "Actor",
    uuid,
    name: o.name ?? uuid,
    img: "",
    type: o.type ?? "monster",
    system: { details: { xp: o.xp, alignment: o.alignment ?? "Lawful", level: o.level }, scores: { int: { mod: 1 } } },
    items: o.items ?? [],
    statuses: new Set(o.dead ? ["dead"] : []),
    flags: o.flags ?? {},
    marks: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    canUserModify: () => o.writable !== false,
    testUserPermission: (user) => o.owner === user.id,
    async toggleStatusEffect(id, opts) {
      this.marks.push([id, opts]);
      this.statuses.add(id);
    },
  };
  world.docs.set(uuid, actor);
  return actor;
}

await ta("a creature is valued by lib's valuation: its XP award, nothing for an animal, a summoned or a young creature, a blank for a character", async () => {
  creature("Actor.ogre", { xp: 50, alignment: "Chaotic", flags: { "acks-extras": { extras: { secondary: { intelligence: "sapient" } } } } });
  const ogre = await L.victimFacts("Actor.ogre");
  assert.deepEqual([ogre.value.gp, ogre.value.source, ogre.alignment, ogre.sapient, ogre.kind, ogre.dead], [50, "xp", "chaotic", true, "actor", false]);
  assert.equal((await L.victimFacts("Actor.ogre", { young: true })).value.source, "excluded", "the Judge's young mark bars the XP award");
  creature("Actor.bull", { xp: 9, type: "acks-extras.animal" });
  const bull = await L.victimFacts("Actor.bull");
  assert.deepEqual([bull.value.source, bull.value.reason], ["excluded", "animal"]);
  creature("Actor.imp", { xp: 9, flags: { "acks-extras": { summonedBy: { uuid: "Actor.c" } } } });
  assert.equal((await L.victimFacts("Actor.imp")).value.reason, "summoned");
  creature("Actor.nobody", { xp: undefined });
  assert.equal((await L.victimFacts("Actor.nobody")).value.gp, null, "an award that is not read is blank and never zero");
  creature("Actor.pc", { type: "character", level: 3 });
  const pc = await L.victimFacts("Actor.pc");
  assert.deepEqual([pc.value.gp, pc.sapient, pc.isMonster], [null, true, false], "no award-by-level table is imported, so a character's value is blank until a Judge enters it");
  assert.equal(await L.victimFacts("Actor.gone"), null);
  creature("Actor.corpse", { xp: 5, dead: true });
  assert.equal((await L.victimFacts("Actor.corpse")).dead, true);
});

await ta("a creature already held is held again by neither its actor nor its token", async () => {
  const actor = creature("Actor.twin", { xp: 5 });
  const token = { documentName: "Token", uuid: "Scene.s.Token.twin", actor };
  world.docs.set(token.uuid, token);
  assert.equal(await L.holdsCreature([{ uuid: "Actor.twin" }], token), true, "a token of a held actor is the same creature");
  assert.equal(await L.holdsCreature([{ uuid: token.uuid }], actor), true, "and an actor of a held token");
  assert.equal(await L.holdsCreature([{ uuid: "Actor.twin" }], creature("Actor.other")), false);
  assert.equal(await L.holdsCreature([], actor), false);
});

await ta("a token drop is read as the creature behind it", async () => {
  const actor = creature("Actor.base", { xp: 20 });
  world.docs.set("Scene.s.Token.t", { documentName: "Token", uuid: "Scene.s.Token.t", actor, texture: { src: "tok.png" } });
  const facts = await L.victimFacts("Scene.s.Token.t");
  assert.deepEqual([facts.kind, facts.img, facts.value.gp], ["token", "tok.png", 20]);
});

await ta("the Judge's seat marks every victim itself, with core's dead status as an overlay, and relays nothing", async () => {
  world.isGM = true;
  world.emitted.length = 0;
  const a = creature("Actor.v1");
  const done = await L.markVictims({ uuid: "Actor.c" }, ["Actor.v1"]);
  assert.deepEqual(done.marked, ["Actor.v1"]);
  assert.deepEqual(a.marks, [["dead", { active: true, overlay: true }]]);
  assert.deepEqual(world.emitted, []);
  assert.ok(world.docs.has("Actor.v1"), "a victim is never deleted");
});

await ta("a Player's seat relays the mark of a creature it cannot write to the GM's client, and writes what it may itself", async () => {
  world.isGM = false;
  world.emitted.length = 0;
  const locked = creature("Actor.v2", { writable: false });
  const mine = creature("Actor.v3");
  const done = await L.markVictims({ uuid: "Actor.c" }, ["Actor.v2", "Actor.v3"]);
  assert.deepEqual(locked.marks, [], "the seat did not write what it may not");
  assert.equal(mine.marks.length, 1);
  assert.equal(world.emitted.length, 1);
  assert.deepEqual([world.emitted[0].action, world.emitted[0].payload.casterUuid, world.emitted[0].payload.uuids], ["magicSacrifice", "Actor.c", ["Actor.v2"]]);
  assert.deepEqual(done.marked, ["Actor.v3"], "a relayed mark that was not answered is not counted as made");
  assert.deepEqual(done.failed, ["Actor.v2"]);
  world.isGM = true;
});

await ta("with no Judge connected the relay is refused and nothing is claimed marked", async () => {
  world.isGM = false;
  world.activeGM = false;
  creature("Actor.v4", { writable: false });
  const done = await L.markVictims({ uuid: "Actor.c" }, ["Actor.v4"]);
  assert.deepEqual([done.marked, done.refused], [[], "noGm"]);
  world.isGM = true;
  world.activeGM = true;
});

await ta("the GM's client marks for the caster's owner and refuses another sender, a dead victim and a non-creature", async () => {
  world.isGM = true;
  const caster = creature("Actor.c", { owner: "pl1" });
  creature("Actor.v5");
  creature("Actor.v6", { dead: true });
  world.docs.set("Item.i", { documentName: "Item", uuid: "Item.i" });
  const ask = (uuids, requestUserId = "pl1", casterUuid = "Actor.c") => L.sacrificeHandler({ casterUuid, uuids, requestUserId });
  assert.deepEqual(await ask(["Actor.v5"]), { ok: true, marked: ["Actor.v5"] });
  assert.equal(world.docs.get("Actor.v5").marks.length, 1);
  assert.deepEqual(await ask(["Actor.v5"], "pl9"), { ok: false, reason: "owner" });
  assert.deepEqual(await ask(["Actor.v6"]), { ok: false, reason: "dead" });
  assert.deepEqual(await ask(["Item.i"]), { ok: false, reason: "victim" });
  assert.deepEqual(await ask(["Actor.v5"], "pl1", "Actor.nobody-here"), { ok: false, reason: "noCaster" });
  assert.deepEqual(await L.sacrificeHandler({ casterUuid: "Actor.c", uuids: ["Actor.v1x"], requestUserId: null }), { ok: false, reason: "victim" });
  creature("Actor.v7");
  assert.deepEqual(await L.sacrificeHandler({ casterUuid: "Actor.c", uuids: ["Actor.v7"], requestUserId: null }), { ok: true, marked: ["Actor.v7"] }, "a Judge's own request needs no ownership");
  assert.equal(caster.marks.length, 0);
});

await ta("the card names the throw, the power gained and who was marked dead; a sacrifice that yielded nothing says so", async () => {
  globalThis.ChatMessage = { create: async (data) => (world.posted.push(data), data), getSpeaker: () => ({}) };
  const p = plan({ state: ticked });
  await L.postCard({ ok: true, outcome: "success", success: true, die: 14, total: 15, target: 15, amount: 1200, kind: "divine", marked: ["A"], failed: [], gain: { ok: true } }, p, { caster: CASTER, tables: TABLES });
  const html = world.posted.at(-1).content;
  assert.match(html, /card\.power\.divine/);
  assert.match(html, /card\.dead/);
  assert.match(html, /15/);
  await L.postCard({ ok: true, nothing: true, amount: 0, marked: [], failed: [], kind: "divine" }, p, { caster: CASTER, tables: TABLES });
  const nothing = world.posted.at(-1).content;
  assert.match(nothing, /card\.nothing/);
  assert.equal(nothing.split("card.nothing").length - 1, 1, "the line is said once");
});

/* ------------------------------ the shared record: the model ------------------------------ */

const R = await import("../scripts/magic/sacrifice-record.mjs");
const RL = await import("../scripts/magic/sacrifice-record-live.mjs");

t("a stored record is cleaned: each victim once, in order, with cleaned facts, and a uuid's dots are only characters", () => {
  const rec = R.cleanRecord({ site: 1, power: true, list: [{ uuid: "Scene.s.Token.t", willing: true, traits: ["2", 0, 0, -1, "x"], value: "40" }, { uuid: "Scene.s.Token.t" }, { uuid: "" }, null, { uuid: "Actor.b", helpless: "yes" }] });
  assert.deepEqual(rec, { site: false, power: true, list: [{ uuid: "Scene.s.Token.t", willing: true, helpless: false, young: false, traits: [0, 2], value: 40 }, { uuid: "Actor.b", willing: false, helpless: false, young: false, traits: [], value: null }] });
  assert.deepEqual(R.cleanRecord(undefined), R.emptyRecord());
  assert.equal(R.isOpen(undefined), false);
  assert.equal(R.isOpen({}), false);
  assert.equal(R.isOpen({ site: false }), true);
});

t("the record is the window's state: the bucket's list, the two facts and each victim's facts by uuid, which the plan reads as it always did", () => {
  const rec = { site: true, power: false, list: [{ uuid: "A", helpless: true, traits: [0] }] };
  const st = R.stateOf(rec);
  assert.deepEqual(st.list, [{ uuid: "A", qty: 1, fit: "" }]);
  assert.deepEqual(st.victims.A, { willing: false, helpless: true, young: false, traits: [0], value: null });
  assert.deepEqual(keys(plan({ state: st })), keys(plan({ state: state({ victims: { A: { helpless: true, traits: [0] } } }) })));
  assert.equal(plan({ state: st }).canAct, true);
});

t("an op is applied to the freshest record: a drop once, a removal, the Judge's facts for held victims only, and a clear", () => {
  const base = { site: false, power: false, list: [{ uuid: "A" }] };
  const frozen = JSON.stringify(base);
  const added = R.applyOp(base, { op: "add", uuid: "B" });
  assert.deepEqual(added.list.map((v) => v.uuid), ["A", "B"]);
  assert.deepEqual(R.applyOp(added, { op: "add", uuid: "B" }).list.map((v) => v.uuid), ["A", "B"], "a victim is not added twice");
  assert.deepEqual(R.applyOp(added, { op: "remove", uuid: "A" }).list.map((v) => v.uuid), ["B"]);
  const set = R.applyOp(added, { op: "judge", site: true, victims: { A: { helpless: true, value: "75", ignored: 1 }, Z: { helpless: true } } });
  assert.equal(set.site, true);
  assert.equal(set.power, false, "a fact the op does not name is left as it was");
  assert.deepEqual([set.list[0].helpless, set.list[0].value, set.list[1].helpless], [true, 75, false]);
  assert.equal(set.list.some((v) => v.uuid === "Z"), false, "a fact for a victim that is not held changes nothing");
  assert.deepEqual(R.applyOp(set, { op: "judge", victims: { A: { value: null } } }).list[0].value, null, "a blanked value goes back to unset");
  assert.equal(R.applyOp(set, { op: "clear" }), null);
  const marked = R.applyOp(set, { op: "judge", power: true });
  assert.deepEqual(R.applyOp(marked, { op: "clear" }), { site: false, power: true, list: [] }, "a clear keeps the class-power mark, which is the caster's");
  assert.equal(JSON.stringify(base), frozen, "the record passed in is never changed");
  assert.deepEqual(R.applyOp(base, { op: "nonsense" }), R.cleanRecord(base));
});

t("a form's op carries only what differs from the record, so a Judge's tick does not carry the rest of the form over a Player's drop", () => {
  const rec = { site: true, power: false, list: [{ uuid: "A", helpless: true, traits: [0], value: 5 }] };
  const same = { site: true, victims: { A: { helpless: true, traits: [0], value: "5" } } };
  assert.equal(R.diffJudge(rec, same), null, "nothing differs");
  assert.deepEqual(R.diffJudge(rec, { ...same, power: true }), { op: "judge", power: true });
  assert.deepEqual(R.diffJudge(rec, { victims: { A: { traits: [0, 1] } } }), { op: "judge", victims: { A: { traits: [0, 1] } } });
  assert.deepEqual(R.diffJudge(rec, { victims: { A: { value: "" } } }), { op: "judge", victims: { A: { value: null } } }, "an emptied box is the value unset");
  assert.equal(R.diffJudge(rec, { victims: { Gone: { helpless: true } } }), null, "a victim a Player's removal took meanwhile is not written back");
  assert.equal(R.diffJudge(rec, { site: undefined, victims: { A: {} } }), null, "a control the form did not carry is not compared");
});

t("who may write the record, decided from the attested sender: a Judge or an owner of the caster for every op, the facts included; no one else for any", () => {
  const ask = (op, o = {}) => R.checkRecordRequest({ casterUuid: "C", op }, { caster: { uuid: "C" }, fromJudge: false, owns: true, resolved: { creature: true, held: false }, ...o });
  assert.deepEqual(ask({ op: "add", uuid: "A" }), { ok: true });
  assert.deepEqual(ask({ op: "remove", uuid: "A" }), { ok: true });
  assert.deepEqual(ask({ op: "clear" }), { ok: true });
  assert.deepEqual(ask({ op: "judge", site: true }), { ok: true }, "an owning Player sets the facts");
  assert.equal("judgeOnly" in R.REFUSED, false, "no refusal is left for the facts op");
  assert.deepEqual(ask({ op: "judge", site: true }, { fromJudge: true, owns: false }), { ok: true });
  assert.deepEqual(ask({ op: "add", uuid: "A" }, { owns: false }), { refused: "owner" });
  assert.deepEqual(ask({ op: "judge", site: true }, { owns: false }), { refused: "owner" });
  assert.deepEqual(ask({ op: "add", uuid: "A" }, { caster: null }), { refused: "noCaster" });
  assert.deepEqual(ask({ op: "wipe" }), { refused: "op" });
  assert.deepEqual(ask(undefined), { refused: "op" });
  assert.deepEqual(ask({ op: "add", uuid: "A" }, { resolved: { creature: false, held: false } }), { refused: "victim" });
  assert.deepEqual(ask({ op: "add", uuid: "A" }, { resolved: { creature: true, held: true } }), { refused: "duplicate" });
  assert.deepEqual(ask({ op: "add", uuid: "C" }), { refused: "self" });
  assert.deepEqual(ask({ op: "add", uuid: "A" }, { resolved: { creature: true, held: false, self: true } }), { refused: "self" }, "a token of the caster is the caster");
});

t("an update touches the record in every spelling of a set or a deletion, and not for another flag", () => {
  const flags = (magic) => ({ flags: { "acks-extras": { magic } } });
  assert.equal(R.touchesRecord(flags({ sacrifice: { site: true } })), true);
  assert.equal(R.touchesRecord(flags({ "-=sacrifice": null })), true);
  assert.equal(R.touchesRecord(flags({ "==sacrifice": {} })), true);
  assert.equal(R.touchesRecord(flags({ sacrifice: new foundry.data.operators.ForcedDeletion() })), true, "the operator a clear writes");
  assert.equal(R.touchesRecord({ flags: { "acks-extras": { "-=magic": null } } }), true, "the whole magic object deleted takes the record");
  assert.equal(R.touchesRecord({ flags: { "acks-extras": { magic: null } } }), true);
  assert.equal(R.touchesRecord({ "flags.acks-extras.magic.sacrifice": { site: true } }), true);
  assert.equal(R.touchesRecord({ "flags.acks-extras.magic.-=sacrifice": null }), true);
  assert.equal(R.touchesRecord(flags({ formulas: [] })), false, "the researcher's formulas beside it are another record");
  assert.equal(R.touchesRecord({ flags: { "acks-extras": { power: {} } } }), false);
  assert.equal(R.touchesRecord({ name: "x" }), false);
  assert.equal(R.touchesRecord(undefined), false);
});

t("the Sacrifice button: a Judge's seat on every caster the strip draws, a Player's on a chaotic divine caster or a marked class power", () => {
  const seen = (o) => R.openerVisible(o);
  assert.equal(seen({ judge: true, casts: true }), true);
  assert.equal(seen({ judge: true, casts: false }), false, "an actor the strip does not draw for has no button");
  assert.equal(seen({ divine: true, alignment: "chaotic" }), true, "a Player's, with an empty ledger and nothing cast yet");
  assert.equal(seen({ divine: true, alignment: "lawful" }), false);
  assert.equal(seen({ divine: true, alignment: "neutral" }), false);
  assert.equal(seen({ divine: false, alignment: "chaotic" }), false);
  assert.equal(seen({ divine: false, alignment: "lawful", power: true }), true, "the Judge's class-power mark");
  assert.equal(seen({}), false);
});

/* ------------------------------ the shared record: the live half ------------------------------ */

/** A deep merge as an actor update does it: objects merge key by key, arrays and scalars replace, a `-=` key deletes. */
function applyUpdate(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let at = target;
    for (const part of parts.slice(0, -1)) at = at[part] ??= {};
    const last = parts.at(-1);
    if (value instanceof foundry.data.operators.ForcedDeletion) delete at[last];
    else if (last.startsWith("-=")) delete at[last.slice(2)];
    else if (value && typeof value === "object" && !Array.isArray(value) && at[last] && typeof at[last] === "object") applyUpdate(at[last], Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v])));
    else at[last] = JSON.parse(JSON.stringify(value));
  }
}

/** A caster that keeps its flags, records every update and says who owns it. */
function casterDoc(uuid, o = {}) {
  const doc = creature(uuid, { type: "character", alignment: o.alignment ?? "Chaotic", owner: o.owner ?? "pl1", flags: o.flags });
  doc.updates = [];
  doc.update = async (patch) => {
    doc.updates.push(patch);
    applyUpdate(doc, patch);
  };
  return doc;
}
const stored = (actor) => actor.flags?.["acks-extras"]?.magic?.sacrifice;

await ta("the Judge's seat writes the record through the handler: a drop, the Judge's facts, a removal, and the clear that leaves the formulas beside it", async () => {
  world.isGM = true;
  world.emitted.length = 0;
  const caster = casterDoc("Actor.rc", { flags: { "acks-extras": { magic: { formulas: [{ key: "f" }] } } } });
  creature("Actor.rv1");
  creature("Actor.rv2");
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Actor.rv1" }), { ok: true });
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Actor.rv2" }), { ok: true });
  assert.deepEqual(stored(caster).list.map((v) => v.uuid), ["Actor.rv1", "Actor.rv2"]);
  await RL.writeRecord(caster, { op: "judge", site: true, victims: { "Actor.rv1": { helpless: true, value: 30 } } });
  assert.deepEqual([stored(caster).site, stored(caster).list[0].helpless, stored(caster).list[0].value], [true, true, 30]);
  await RL.writeRecord(caster, { op: "remove", uuid: "Actor.rv1" });
  assert.deepEqual(stored(caster).list.map((v) => v.uuid), ["Actor.rv2"], "a removed victim is gone from the stored list, not merged back");
  assert.equal(stored(caster).site, true, "the facts stay when a victim leaves");
  const before = caster.updates.length;
  await RL.writeRecord(caster, { op: "judge", site: true });
  assert.equal(caster.updates.length, before, "a write that changes nothing is not made");
  assert.deepEqual(world.emitted, [], "a Judge's seat relays nothing");
  await RL.clearRecord(caster);
  assert.equal(stored(caster), undefined, "the record is the open sacrifice, and it is gone");
  assert.ok(caster.updates.at(-1)["flags.acks-extras.magic.sacrifice"] instanceof foundry.data.operators.ForcedDeletion, "deleted by core's operator, never null or the legacy key");
  assert.deepEqual(caster.flags["acks-extras"].magic.formulas, [{ key: "f" }], "only the sacrifice key goes, never the magic object");
  const quiet = caster.updates.length;
  assert.deepEqual(await RL.clearRecord(caster), { ok: true, noop: true });
  assert.equal(caster.updates.length, quiet, "a clear with nothing open writes nothing");
  await RL.writeRecord(caster, { op: "add", uuid: "Actor.rv2" });
  await RL.writeRecord(caster, { op: "judge", site: true, power: true });
  await RL.clearRecord(caster);
  assert.deepEqual(stored(caster), { site: false, power: true, list: [] }, "the class-power mark outlives the sacrifice");
  const kept = caster.updates.length;
  await RL.clearRecord(caster);
  assert.equal(caster.updates.length, kept, "a second clear of a mark-only record writes nothing");
});

await ta("a drop the GM's client cannot read as a creature, the caster itself, and a creature already held are refused", async () => {
  world.isGM = true;
  const caster = casterDoc("Actor.rc2");
  const twin = creature("Actor.twin2");
  world.docs.set("Scene.s.Token.twin2", { documentName: "Token", uuid: "Scene.s.Token.twin2", actor: twin });
  world.docs.set("Item.rx", { documentName: "Item", uuid: "Item.rx" });
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Actor.no-such-creature" }), { ok: false, reason: "victim" });
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Item.rx" }), { ok: false, reason: "victim" });
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Actor.rc2" }), { ok: false, reason: "self" });
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Actor.twin2" }), { ok: true });
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Scene.s.Token.twin2" }), { ok: false, reason: "duplicate" }, "a token of a held actor is the same creature");
  assert.deepEqual(stored(caster).list.length, 1);
});

await ta("a Player's seat asks the GM's client for every write; the GM's client writes an owner's facts and drop, and refuses a stranger's", async () => {
  const caster = casterDoc("Actor.rc3", { owner: "pl1" });
  creature("Actor.rv3");
  world.isGM = false;
  world.activeGM = true;
  world.emitted.length = 0;
  const writes = caster.updates.length;
  await RL.writeRecord(caster, { op: "judge", site: true });
  await RL.writeRecord(caster, { op: "add", uuid: "Actor.rv3" });
  assert.equal(caster.updates.length, writes, "the Player's seat writes nothing itself");
  assert.deepEqual(world.emitted.map((m) => [m.action, m.payload.casterUuid, m.payload.op.op]), [["magicSacrifice", "Actor.rc3", "judge"], ["magicSacrifice", "Actor.rc3", "add"]], "each rides the sacrifice's own handler");
  world.isGM = true;
  const ask = (op, requestUserId) => L.sacrificeHandler({ casterUuid: "Actor.rc3", op, requestUserId });
  assert.deepEqual(await ask({ op: "judge", site: true, power: true }, "pl9"), { ok: false, reason: "owner" });
  assert.equal(stored(caster), undefined, "a stranger's facts changed nothing");
  assert.deepEqual(await ask({ op: "judge", site: true, power: true }, "pl1"), { ok: true }, "the owner's facts are written");
  assert.deepEqual([stored(caster).site, stored(caster).power], [true, true]);
  assert.deepEqual(await ask({ op: "clear" }, "pl1"), { ok: true });
  assert.deepEqual(stored(caster), { site: false, power: true, list: [] }, "cleared down to the class-power mark");
  assert.deepEqual(await ask({ op: "judge", power: false }, "pl1"), { ok: true });
  assert.deepEqual(await ask({ op: "clear" }, "pl1"), { ok: true });
  assert.equal(stored(caster), undefined);
  assert.deepEqual(await ask({ op: "add", uuid: "Actor.rv3" }, "pl9"), { ok: false, reason: "owner" });
  assert.equal(stored(caster), undefined, "a stranger's drop changed nothing");
  assert.deepEqual(await ask({ op: "add", uuid: "Actor.rv3" }, "pl1"), { ok: true });
  assert.deepEqual(stored(caster).list.map((v) => v.uuid), ["Actor.rv3"]);
  assert.deepEqual(await ask({ op: "judge", site: true }, "pl9"), { ok: false, reason: "owner" });
  assert.deepEqual(await ask({ op: "judge", site: true }, "pl1"), { ok: true }, "the owner's facts land beside the drop");
  assert.deepEqual(await ask({ op: "judge", site: true }, null), { ok: true }, "the same facts from a Judge change nothing more");
  assert.equal(stored(caster).site, true);
  assert.deepEqual(await ask({ op: "clear" }, "pl9"), { ok: false, reason: "owner" });
  assert.equal(stored(caster).site, true, "a stranger's clear is refused");
  assert.deepEqual(await ask({ op: "clear" }, "pl1"), { ok: true }, "the owner ends the sacrifice they made");
  assert.equal(stored(caster), undefined);
  assert.deepEqual(await L.sacrificeHandler({ casterUuid: "Actor.rc3", uuids: ["Actor.rv3"], requestUserId: "pl9" }), { ok: false, reason: "owner" }, "the mark request is still answered as it was");
});

await ta("with no Judge connected a Player's write is refused and not claimed made", async () => {
  const caster = casterDoc("Actor.rc4");
  world.isGM = false;
  world.activeGM = false;
  assert.deepEqual(await RL.writeRecord(caster, { op: "add", uuid: "Actor.rv3" }), { ok: false, reason: "noGm" });
  world.isGM = true;
  world.activeGM = true;
});

await ta("an update to the record draws the open window for that caster again, and an update to anything else does not", async () => {
  let drawn = 0;
  RL.openWindows.set("Actor.rc5", { render: () => void drawn++ });
  RL.onActorUpdate({ uuid: "Actor.rc5" }, { flags: { "acks-extras": { magic: { sacrifice: { site: true } } } } });
  RL.onActorUpdate({ uuid: "Actor.rc5" }, { flags: { "acks-extras": { magic: { "-=sacrifice": null } } } });
  RL.onActorUpdate({ uuid: "Actor.rc5" }, { flags: { "acks-extras": { magic: { formulas: [] } } } });
  RL.onActorUpdate({ uuid: "Actor.other" }, { flags: { "acks-extras": { magic: { sacrifice: { site: true } } } } });
  assert.equal(drawn, 2, "a set and a deletion, not the formulas and not another caster");
  RL.openWindows.delete("Actor.rc5");
  RL.onActorUpdate({ uuid: "Actor.rc5" }, { flags: { "acks-extras": { magic: { sacrifice: { site: true } } } } });
  assert.equal(drawn, 2, "a window that left the registry is not drawn, so a close's own clear never reopens it");
  L.registerSacrifice();
  assert.equal(hooked.filter(([name, fn]) => name === "updateActor" && fn === RL.onActorUpdate).length, 1, "the hook is registered once, at init");
  L.registerSacrifice();
  assert.equal(hooked.filter(([, fn]) => fn === RL.onActorUpdate).length, 1, "and not again by a second call");
});

await ta("the casting strip's button: the opener reads the seat, the tradition, the alignment and the mark, and names the caster in its tooltip", async () => {
  world.docs.set("Item.divcls", { documentName: "Item", uuid: "Item.divcls", type: "acks-extras.class", system: { casting: [{ key: "Divine" }] } });
  world.docs.set("Item.arccls", { documentName: "Item", uuid: "Item.arccls", type: "acks-extras.class", system: { casting: [{ key: "arcane" }] } });
  const cls = (uuid) => ({ "acks-extras": { classes: { uuid } } });
  const format = game.i18n.format;
  game.i18n.format = (key, data) => (data ? `${key}${JSON.stringify(data)}` : key);
  try {
    const divineChaotic = casterDoc("Actor.o1", { alignment: "Chaotic", flags: cls("Item.divcls") });
    const divineLawful = casterDoc("Actor.o2", { alignment: "Lawful", flags: cls("Item.divcls") });
    const arcaneChaotic = casterDoc("Actor.o3", { alignment: "Chaotic", flags: cls("Item.arccls") });
    const arcaneMarked = casterDoc("Actor.o4", { alignment: "Lawful", flags: { ...cls("Item.arccls"), "acks-extras": { classes: { uuid: "Item.arccls" }, magic: { sacrifice: { power: true } } } } });
    world.isGM = false;
    const player = (a) => RL.openerFor(a, false);
    assert.notEqual(player(divineChaotic), null, "a Player's divine chaotic caster, with nothing cast");
    assert.equal(player(divineLawful), null);
    assert.equal(player(arcaneChaotic), null);
    assert.notEqual(player(arcaneMarked), null, "the class-power mark");
    assert.match(player(divineChaotic).tip, /openTip.*"name":"Actor\.o1".*"cite":"ACKS-MAGIC\.sacrifice\.cite\.sacrifice/, "the tooltip names the caster and the page");
    world.isGM = true;
    assert.notEqual(RL.openerFor(divineLawful, true), null, "a Judge's seat on every caster");
    assert.equal(RL.openerFor(divineLawful, false), null);
    const chip = await import("../scripts/classes/power-chip.mjs");
    const html = chip.openerHtml(divineLawful, true);
    assert.match(html, /<button type="button" class="acks-btn acks-extras-classes-sacrifice" data-sacrifice-open="1" data-tooltip-text="ACKS-MAGIC\.sacrifice\.openTip/);
    assert.doesNotMatch(html, /\sid=|\stitle=/);
    world.isGM = false;
    assert.equal(chip.openerHtml(divineLawful, true), "", "no button for a Player on a lawful caster");
    const section = chip.powerSectionHtml(divineChaotic, false);
    const chipsLine = (html) => html.slice(html.indexOf('powerchips">'), html.indexOf("</div>", html.indexOf('powerchips">')));
    assert.doesNotMatch(chipsLine(section), /data-sacrifice-open/, "not on the strip line");
    assert.match(section.slice(section.indexOf('data-power-panel="divine"')), /data-sacrifice-open/, "inside the divine panel, even where the ledger holds nothing");
    assert.equal((section.match(/data-sacrifice-open/g) ?? []).length, 1, "one panel shown, one button");
    const lawful = chip.powerSectionHtml(divineLawful, false);
    assert.match(lawful, /data-power-toggle/, "a Player's lawful divine caster still has its icon");
    assert.doesNotMatch(lawful, /data-sacrifice-open/, "and no Sacrifice button, which the seat's rule refuses");
    assert.match(chip.powerSectionHtml(arcaneMarked, false), /data-power-kind="arcane"[^]*data-sacrifice-open/, "the class-power mark shows the arcane icon and its panel's button");
    assert.equal(chip.powerSectionHtml(arcaneChaotic, false).includes("data-sacrifice-open"), false, "an unmarked arcane caster of a Player has none");
    world.docs.set("Item.bothcls", { documentName: "Item", uuid: "Item.bothcls", type: "acks-extras.class", system: { casting: [{ key: "divine" }, { key: "arcane" }] } });
    world.docs.set("Item.gnoscls", { documentName: "Item", uuid: "Item.gnoscls", type: "acks-extras.class", system: { casting: [{ key: "gnosis" }] } });
    const both = casterDoc("Actor.o5", { alignment: "Lawful", flags: cls("Item.bothcls") });
    const gnostic = casterDoc("Actor.o6", { alignment: "Lawful", flags: cls("Item.gnoscls") });
    world.isGM = true;
    const judgeBoth = chip.powerSectionHtml(both, true);
    assert.equal((judgeBoth.match(/data-sacrifice-open/g) ?? []).length, 2, "a Judge's seat on a caster of both: one button in each panel");
    assert.doesNotMatch(chipsLine(judgeBoth), /data-sacrifice-open/);
    const panels = judgeBoth.split('data-power-panel="').slice(1);
    assert.ok(panels.length === 2 && panels.every((p) => (p.match(/data-sacrifice-open/g) ?? []).length === 1), "each panel holds its own");
    assert.notEqual(RL.openerFor(gnostic, true), null, "the rule allows the Judge's button on a caster of neither key");
    assert.notEqual(chip.openerHtml(gnostic, true), "");
    assert.equal(chip.powerSectionHtml(gnostic, true), "", "but with no power shown the strip draws no section and no button, and the window stays open to the API");
    const gnosticMarked = casterDoc("Actor.o7", { alignment: "Lawful", flags: { ...cls("Item.gnoscls"), "acks-extras": { classes: { uuid: "Item.gnoscls" }, magic: { sacrifice: { power: true } } } } });
    assert.match(chip.powerSectionHtml(gnosticMarked, true), /data-sacrifice-open/, "the class-power mark brings the arcane panel and so the button");
    world.isGM = false;
  } finally {
    game.i18n.format = format;
    world.isGM = true;
  }
});

/* ------------------------------ the window's markup ------------------------------ */

const Handlebars = (await import("handlebars")).default;

/** Render the bucket and the footer as the window's files do, over the model's own view. */
function renderWindow(model) {
  const hbs = Handlebars.create();
  hbs.registerHelper("localize", (key) => key);
  hbs.registerHelper("eq", (a, b) => a === b);
  const dir = (f) => fs.readFileSync(f, "utf8");
  hbs.registerPartial("modules/acks-extras/templates/lib/bucket-row.hbs", dir("templates/lib/bucket-row.hbs"));
  hbs.registerPartial(PARTIAL, dir("templates/magic/sacrifice-victim.hbs"));
  const bucket = hbs.compile(dir("templates/lib/bucket.hbs"))(model.bucket);
  const body = hbs.compile(dir("templates/magic/sacrifice.hbs"), { noEscape: false });
  hbs.registerPartial("modules/acks-extras/templates/lib/bucket.hbs", dir("templates/lib/bucket.hbs"));
  const whole = body({ ...model, caster: { name: "Caster", img: "" } });
  const foot = hbs.compile(dir("templates/magic/sacrifice-footer.hbs"))({ ...model, partId: "p" });
  return { bucket, whole, foot };
}

t("a Judge's victim row holds its checks under the value line, each wrapped in its label, young and the value box on a second line, and no section of states", () => {
  const model = panel({ victims: [victim("A", { isMonster: true, value: { gp: 100, source: "xp", cite: "Invented p. 5", basis: { xp: 100 } } })], state: state({ victims: { A: { helpless: true, traits: [1], value: 250 } } }) });
  const { bucket, whole } = renderWindow(model);
  const row = bucket.slice(bucket.indexOf("<li"), bucket.indexOf("</li>"));
  assert.ok(row.indexOf("acks-extras-bucket__figure") < row.indexOf("data-field=\"helpless\""), "the checks are under the value line");
  assert.equal((row.match(/<input/g) ?? []).length, 6, "helpless, three trait rows, young, and the value box");
  assert.equal((row.match(/<label[^>]*>[^]*?<\/label>/g) ?? []).length, (row.match(/<input/g) ?? []).length, "every control is inside a label of its own");
  assert.match(row, /data-victim="A" data-value value="250"/);
  assert.match(row, /class="acks-input acks-nums is-edited"/, "a hand-set value carries the gold edge");
  assert.match(row, /data-field="young"/);
  assert.doesNotMatch(whole, /acks-extras-sacrifice-states|ACKS-MAGIC\.sacrifice\.states/);
  assert.doesNotMatch(row, /\sid=|\stitle=/);
  const blank = renderWindow(panel({ state: state({ victims: { A: { helpless: true } } }) })).bucket;
  assert.doesNotMatch(blank, /is-edited/, "an unset value carries no edge");
});

t("a Player's row reads the same facts as text, with no control in it", () => {
  const model = readOnly({state: state({ victims: { A: { helpless: true, traits: [0] } } }) });
  const { bucket, whole } = renderWindow(model);
  const row = bucket.slice(bucket.indexOf("<li"), bucket.indexOf("</li>"));
  assert.match(row, /<span class="acks-extras-sacrifice-readonly">helpless · Trait A<\/span>/);
  assert.doesNotMatch(row, /<input|data-value/, "no check and no value box at a Player's seat");
  assert.match(whole, /name="site"[^>]*disabled/, "the site check is read-only");
  assert.doesNotMatch(whole, /name="power"/, "and the class-power check is not drawn unless a Judge ticked it");
  const marked = renderWindow(readOnly({state: state({ power: true, victims: { A: HELPLESS } }) })).whole;
  assert.match(marked, /name="power"[^>]*checked[^>]*disabled/);
});

t("an owning Player's window draws the controls: checks and the value box in the row, site and power enabled, and a footer with no waiting line", () => {
  const { bucket, whole, foot } = renderWindow(owning({ victims: [victim("A", { isMonster: true })], state: state({ site: false, victims: { A: {} } }) }));
  const row = bucket.slice(bucket.indexOf("<li"), bucket.indexOf("</li>"));
  assert.match(row, /data-field="helpless"/);
  assert.match(row, /data-field="young"/);
  assert.match(row, /data-victim="A" data-value/);
  assert.doesNotMatch(row, /acks-extras-sacrifice-readonly/);
  assert.doesNotMatch(whole, /name="site"[^>]*disabled/);
  assert.match(whole, /name="power"/);
  assert.doesNotMatch(whole, /name="power"[^>]*disabled/);
  assert.doesNotMatch(foot, /is-wait|waiting\{/);
});

t("the class-power check reads as the board words it and sets the yield to arcane power", () => {
  const model = panel({ state: state({ power: true, victims: { A: HELPLESS } }) });
  assert.equal(model.power.label, "power");
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  assert.equal(lang["ACKS-MAGIC.sacrifice.power"], "Holds the sacrifice power (arcane)");
  assert.equal(lang["ACKS-MAGIC.sacrifice.yield.now.arcane"], "Arcane power now");
  assert.equal(model.yield.now.label, "yield.now.arcane");
  assert.equal(model.yield.now.text, "600", "counted through the imported multiple");
  assert.equal(panel().yield.now.label, "yield.now.divine");
});

t("the footer: a Player's waiting line is named and its button stays disabled, described by it; once nothing waits the button is free", () => {
  const waiting = readOnly({state: state({ site: false, victims: { A: HELPLESS } }) });
  const held = renderWindow(waiting).foot;
  assert.match(held, /<li data-severity="wait" class="is-wait"><i class="fa-solid fa-hourglass-half" inert><\/i> waiting\{/);
  assert.match(held, /data-action="sacrifice" aria-disabled="true" aria-describedby="p-why"/);
  const freed = renderWindow(readOnly({state: state({ site: true, victims: { A: HELPLESS } }) })).foot;
  assert.doesNotMatch(freed, /aria-disabled|<li /, "no hold, no line, a button that acts");
  assert.doesNotMatch(held, /\sid="(?!\{|p-why)/);
});

t("the record's round trip through the window's model: what a Judge sets is what a Player's window draws, and the Player's Sacrifice frees itself", () => {
  const rec = { site: false, power: false, list: [{ uuid: "A" }] };
  const asPlayer = (record) => readOnly({state: R.stateOf(record) });
  const waiting = asPlayer(rec);
  assert.deepEqual([waiting.blocked, waiting.lines.map((l) => l.severity)], [true, ["wait"]]);
  const afterSite = R.applyOp(rec, { op: "judge", site: true });
  assert.match(asPlayer(afterSite).why, /wait\.notHelpless/, "the site is set; the victim still waits");
  const afterVictim = R.applyOp(afterSite, { op: "judge", victims: { A: { helpless: true } } });
  const freed = asPlayer(afterVictim);
  assert.deepEqual([freed.blocked, freed.lines.length], [false, 0]);
  assert.equal(extraOf(freed).said, "helpless", "and the row shows the Judge's check as text");
  assert.equal(R.applyOp(afterVictim, { op: "clear" }), null);
});

/* ------------------------------ the window's files ------------------------------ */

t("the template and the sheet of styles hold to the layout contract; every string the window asks for exists", () => {
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  const tpl = fs.readFileSync("templates/magic/sacrifice.hbs", "utf8");
  const foot = fs.readFileSync("templates/magic/sacrifice-footer.hbs", "utf8");
  const victimTpl = fs.readFileSync("templates/magic/sacrifice-victim.hbs", "utf8");
  for (const file of [tpl, foot, victimTpl]) {
    assert.doesNotMatch(file, /\sid="[^{]/, "no literal id in a template");
    assert.doesNotMatch(file, /\btitle="/, "no title attribute: the tooltip manager is the tooltip");
  }
  const win = fs.readFileSync("scripts/magic/apps/sacrifice-window.mjs", "utf8");
  assert.doesNotMatch(win.slice(win.indexOf("static async #onForm"), win.indexOf("static async #onRemove")), /isGM/, "the form's gate is not the server role");
  for (const f of ["sacrifice-record.mjs", "sacrifice-record-live.mjs", "sacrifice-live.mjs"]) assert.doesNotMatch(fs.readFileSync(`scripts/magic/${f}`, "utf8"), /isOwner/, `${f} writes no ownership gate`);
  assert.doesNotMatch(win, /#held|instanceof [A-Z]/, "the window holds nothing of its own, and tells a node by nodeType");
  for (const w of ["noSite", "notHelpless", "values"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.wait.${w}`], "string", w);
  for (const r of ["noCaster", "owner", "op", "victim", "self", "duplicate", "noGm"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.refused.${r}`], "string", r);
  // Built from parts: validate reads a whole key literal in a test as a reference that must exist.
  assert.equal(lang[`ACKS-MAGIC.sacrifice.refused.${"judgeOnly"}`], undefined, "no string for a refusal that no longer exists");
  assert.equal(lang["ACKS-MAGIC.sacrifice.waiting"], "Waiting on the caster's owner: {what}");
  assert.equal(lang[["ACKS-MAGIC", "sacrifice", "states"].join(".")], undefined, "the states section is gone");
  const used = new Set();
  for (const file of [tpl, foot, victimTpl]) for (const m of file.matchAll(/ACKS-MAGIC\.sacrifice\.([\w.]+)/g)) used.add(m[1]);
  const live = ["sacrifice-live.mjs", "sacrifice.mjs", "sacrifice-record.mjs", "sacrifice-record-live.mjs"].map((f) => fs.readFileSync(`scripts/magic/${f}`, "utf8")).join("\n") + win;
  for (const m of live.matchAll(/\bloc\(\s*["`]([\w.]+)["`]/g)) used.add(m[1]);
  for (const key of used) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.${key}`], "string", `ACKS-MAGIC.sacrifice.${key}`);
  for (const f of ["noBasis", "noSite", "notHelpless", "sapientRefused", "animalWarn"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.finding.${f}`], "string", f);
  for (const h of ["victims", "casterAlignment", "victimAlignment", "intelligence", "values", "traits", "multiplier", "throw", "int", "blocked"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.hold.${h}`], "string", h);
  for (const r of ["dead", "unwilling", "alignment"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.noYield.${r}`], "string", r);
  for (const [k, v] of Object.entries(lang)) if (k.startsWith("ACKS-MAGIC.sacrifice.")) assert.doesNotMatch(v, /\d+\s*(gp|x|×)\b/i, `${k} states no figure`);
});

console.log(`sacrifice: ${n} cases passed`);
