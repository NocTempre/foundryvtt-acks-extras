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
globalThis.Hooks = { on() {}, once() {} };
globalThis.foundry = { utils: { randomID: () => "id", escapeHTML: (s) => String(s) } };
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

const panel = (over = {}) => S.panelModel({ caster: CASTER, victims: [victim("A")], state: state({ victims: { A: { helpless: true, traits: [0] } } }), tables: TABLES, judge: true, loc: echo, bucketLoc: echo, cites: { sacrifice: "Invented p. 3", value: "Invented p. 5" }, ...over });

t("the bucket's rows are the victims, each with its value; the toggles are the Judge's and disabled at a Player's seat", () => {
  const judge = panel();
  assert.equal(judge.bucket.rows.length, 1);
  assert.equal(judge.bucket.rows[0].valueText.length > 0, true);
  assert.equal(judge.bucket.head, null, "the bucket's own total is replaced by the yield lines");
  assert.deepEqual(judge.states[0].controls.map((c) => [c.field, c.disabled]), [["helpless", false]]);
  assert.equal(judge.states[0].traits.length, 3);
  assert.equal(judge.states[0].traits.every((x) => !x.disabled), true);
  assert.notEqual(judge.states[0].value, null, "a Judge may set a value");
  assert.equal(judge.site.disabled, false);
  const player = panel({ judge: false });
  assert.deepEqual(player.states[0].controls.map((c) => c.disabled), [true]);
  assert.equal(player.states[0].traits.every((x) => x.disabled), true);
  assert.equal(player.states[0].value, null);
  assert.equal(player.site.disabled, true);
  assert.equal(player.power.disabled, true);
});

t("the willing toggle belongs to a chaotic victim and the helpless one to the others; an unread alignment has neither", () => {
  const fields = (a) => panel({ victims: [victim("A", { alignment: a })] }).states[0]?.controls.map((c) => c.field) ?? [];
  assert.deepEqual(fields("chaotic"), ["willing"]);
  assert.deepEqual(fields("lawful"), ["helpless"]);
  assert.deepEqual(fields("neutral"), ["helpless"]);
  assert.deepEqual(fields(null), []);
  assert.deepEqual(panel({ victims: [victim("A", { isMonster: true })] }).states[0].controls.map((c) => c.field), ["helpless", "young"]);
});

t("with no trait table imported no trait check is drawn and the bonus line is blank", () => {
  const p = panel({ tables: { ...TABLES, sacrifice: NOTHING.sacrifice } });
  assert.equal(p.traitsDrawn, false);
  assert.equal(p.states[0].traits.length, 0);
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

t("a Player is blocked and told why; the Sacrifice button is disabled with the reason; a Judge's is enabled with the warning", () => {
  const over = { state: state({ site: false, victims: { A: HELPLESS } }) };
  const player = panel({ ...over, judge: false });
  assert.equal(player.blocked, true);
  assert.equal(player.why, "finding.noSite" + JSON.stringify({ name: "" }));
  assert.equal(player.lines[0].severity, "block");
  const judge = panel({ ...over, judge: true });
  assert.equal(judge.blocked, false);
  assert.equal(judge.lines[0].severity, "warn");
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

/* ------------------------------ the window's files ------------------------------ */

t("the template and the sheet of styles hold to the layout contract; every string the window asks for exists", () => {
  const lang = JSON.parse(fs.readFileSync("lang/en.json", "utf8"));
  const tpl = fs.readFileSync("templates/magic/sacrifice.hbs", "utf8");
  const foot = fs.readFileSync("templates/magic/sacrifice-footer.hbs", "utf8");
  for (const file of [tpl, foot]) {
    assert.doesNotMatch(file, /\sid="[^{]/, "no literal id in a template");
    assert.doesNotMatch(file, /\btitle="/, "no title attribute: the tooltip manager is the tooltip");
  }
  const css = fs.readFileSync("styles/magic.css", "utf8");
  const mine = css.split("\n").filter((l) => /acks-extras-sacrifice/.test(l));
  assert.ok(mine.length > 5, "the window's rules are in the magic sheet");
  assert.doesNotMatch(css.slice(css.indexOf(".acks-extras-sacrifice")), /font-size:\s*[\d.]+(px|rem)\b(?!.*px-ok)/, "no px or rem font size");
  const win = fs.readFileSync("scripts/magic/apps/sacrifice-window.mjs", "utf8");
  assert.match(win, /"acks-extras-scroll"/, "the window joins the scroll contract");
  assert.match(win, /resizable: true/);
  assert.doesNotMatch(win, /isOwner/, "no ownership gate: a verdict is a verdict");
  const used = new Set();
  for (const file of [tpl, foot]) for (const m of file.matchAll(/ACKS-MAGIC\.sacrifice\.([\w.]+)/g)) used.add(m[1]);
  const live = fs.readFileSync("scripts/magic/sacrifice-live.mjs", "utf8") + win + fs.readFileSync("scripts/magic/sacrifice.mjs", "utf8");
  for (const m of live.matchAll(/\bloc\(\s*["`]([\w.]+)["`]/g)) used.add(m[1]);
  for (const key of used) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.${key}`], "string", `ACKS-MAGIC.sacrifice.${key}`);
  for (const f of ["noBasis", "noSite", "notHelpless", "sapientRefused", "animalWarn"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.finding.${f}`], "string", f);
  for (const h of ["victims", "casterAlignment", "victimAlignment", "intelligence", "values", "traits", "multiplier", "throw", "int", "blocked"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.hold.${h}`], "string", h);
  for (const r of ["dead", "unwilling", "alignment"]) assert.equal(typeof lang[`ACKS-MAGIC.sacrifice.noYield.${r}`], "string", r);
  for (const [k, v] of Object.entries(lang)) if (k.startsWith("ACKS-MAGIC.sacrifice.")) assert.doesNotMatch(v, /\d+\s*(gp|x|×)\b/i, `${k} states no figure`);
});

console.log(`sacrifice: ${n} cases passed`);
