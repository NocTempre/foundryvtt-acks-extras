/**
 * Offline tests for the declaration (`scripts/magic/cast-declare.mjs`,
 * `cast-moment.mjs`): the round a declaration lapses at, which records a turn
 * that ends makes stale, the flag relay's check, writing a declaration (and a
 * Judge's second one replacing the first), ending one in the order that lets
 * the flag be cleared, and losing one. Foundry-free; every spell and actor
 * below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-declare.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };

const { lapseRound, turnEnded, staleDeclarations, checkDeclareFlagRequest, declareCast, endDeclaration, onStatesLost, ANSWER_FIELDS, answerStored, answerFromPending } = await import("../scripts/magic/cast-declare.mjs");
const { castMoment, declarationOf, MOMENT } = await import("../scripts/magic/cast-moment.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");

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

t("the moment table: no combat, not begun, begun with initiative unrolled, the caster's turn, another's turn", () => {
  const me = { id: "cb1", initiative: 4 };
  const fight = (over = {}) => ({ started: true, flags: {}, combatant: { id: "cb1" }, ...over });
  assert.equal(castMoment({ combat: null, combatant: null }), MOMENT.free);
  assert.equal(castMoment({ combat: fight({ started: false }), combatant: me }), MOMENT.free);
  assert.equal(castMoment({ combat: fight({ started: false, flags: { acks: { initDone: true } } }), combatant: { id: "cb1", initiative: null } }), MOMENT.declare);
  assert.equal(castMoment({ combat: fight(), combatant: { id: "cb1", initiative: null } }), MOMENT.declare);
  assert.equal(castMoment({ combat: fight(), combatant: me }), MOMENT.resolve);
  assert.equal(castMoment({ combat: fight({ combatant: { id: "cb9" } }), combatant: me }), MOMENT.declare);
});

t("a declaration is told apart by fight and spell, and a stamped one is lost", () => {
  const rec = (castId, spellUuid, combatId, extra = {}) => ({ castId, pending: { spellUuid, combatId, round: 1, ...extra } });
  const all = [rec("a", "S1", "k1"), rec("b", "S1", "k2"), rec("c", "S2", "k1", { lost: { cause: "save" } })];
  assert.equal(declarationOf(all, { spellUuid: "S1", combatId: "k1" }).valid.castId, "a");
  assert.equal(declarationOf(all, { spellUuid: "S2", combatId: "k1" }).lost.castId, "c");
  assert.equal(declarationOf(all, { spellUuid: "S2", combatId: "k1" }).valid, null);
  assert.equal(declarationOf(all, { spellUuid: "S1", combatId: "k2" }).valid.castId, "b");
});

t("a declaration lapses at the caster's turn of this round when that turn is still to come or the initiative is unrolled, and at next round's once it has passed", () => {
  assert.equal(lapseRound({ round: 3, turn: 0, casterTurn: 2, rolled: true }), 3, "the caster acts later this round");
  assert.equal(lapseRound({ round: 3, turn: 2, casterTurn: 0, rolled: true }), 4, "the caster's turn has passed");
  assert.equal(lapseRound({ round: 3, turn: 1, casterTurn: 1, rolled: true }), 4, "declared on the caster's own turn after it began");
  assert.equal(lapseRound({ round: 3, turn: 0, casterTurn: 0, rolled: false }), 3, "before the initiative is rolled");
  assert.equal(lapseRound({ round: 3, turn: 0, casterTurn: -1, rolled: false }), 3);
});

t("a turn ends when the round advances or the tracker moves forward to another combatant; a re-sort after an initiative roll, a move backward and no move end none", () => {
  const at = (round, turn, combatantId) => ({ round, turn, combatantId });
  assert.equal(turnEnded(at(1, 0, "a"), at(1, 1, "b")), true, "forward to another");
  assert.equal(turnEnded(at(1, 1, "b"), at(2, 0, "a")), true, "a new round");
  assert.equal(turnEnded(at(2, 0, "a"), at(3, 0, "a")), true, "a new round with one combatant");
  assert.equal(turnEnded(at(1, 0, "a"), at(1, 1, "a")), false, "the same combatant moved down the order by a re-sort");
  assert.equal(turnEnded(at(1, 0, "a"), at(1, 0, "b")), false, "another combatant took the place");
  assert.equal(turnEnded(at(1, 2, "c"), at(1, 1, "b")), false, "a step back");
  assert.equal(turnEnded(at(1, 0, "a"), at(1, 0, "a")), false);
  assert.equal(turnEnded(null, at(1, 0, "a")), false);
});

t("a turn that ends makes stale the caster's declarations of that fight whose lapse round it has reached, lost or not", () => {
  const rec = (castId, combatId, round, extra = {}) => ({ castId, pending: { spellUuid: "S", combatId, round, ...extra } });
  const records = [rec("a", "k1", 3), rec("b", "k1", 4), rec("c", "k2", 3), rec("d", "k1", 3, { lost: { cause: "damage" } }), { castId: "e" }];
  assert.deepEqual(staleDeclarations(records, { combatId: "k1", round: 3 }).map((r) => r.castId), ["a", "d"], "round 4's waits");
  assert.deepEqual(staleDeclarations(records, { combatId: "k1", round: 4 }).map((r) => r.castId), ["a", "b", "d"]);
  assert.deepEqual(staleDeclarations(records, { combatId: "k1", round: 2 }), [], "a turn before the lapse round ends nothing");
  assert.deepEqual(staleDeclarations(records, { combatId: "k1", round: Infinity }).map((r) => r.castId), ["a", "b", "d"], "a deleted fight ends them all");
});

t("the flag relay: the requester must own the combatant's actor; setting the flag needs a standing declaration, clearing it does not", () => {
  const world = (over = {}) => ({ combatant: { id: "cb1" }, ownsActor: true, declared: true, ...over });
  assert.deepEqual(checkDeclareFlagRequest({ requestUserId: "u", value: true }, world()), { ok: true });
  assert.deepEqual(checkDeclareFlagRequest({ requestUserId: "u", value: true }, world({ ownsActor: false })), { refused: "notOwner" });
  assert.deepEqual(checkDeclareFlagRequest({ requestUserId: "u", value: true }, world({ declared: false })), { refused: "noDeclaration" });
  assert.deepEqual(checkDeclareFlagRequest({ requestUserId: "u", value: false }, world({ declared: false })), { ok: true });
  assert.deepEqual(checkDeclareFlagRequest({ requestUserId: null, value: true }, world({ ownsActor: false })), { ok: true }, "a GM's own");
  assert.deepEqual(checkDeclareFlagRequest({ requestUserId: "u", value: true }, world({ combatant: null })), { refused: "noCombatant" });
});

/** An actor whose effects are a list of records, with the writes recorded. */
function world() {
  const log = [];
  const records = [];
  const deps = {
    log,
    castId: (() => {
      let i = 0;
      return () => `d${++i}`;
    })(),
    now: () => 77,
    entries: () => records.map((r) => ({ id: r.id, record: spellEffectOf(r.data) })),
    remove: async (actor, ids) => {
      log.push(["remove", ...ids]);
      for (const id of ids) records.splice(records.findIndex((r) => r.id === id), 1);
    },
    create: async (actor, datas) => {
      log.push(["create", datas.length]);
      for (const data of datas) records.push({ id: `e${records.length + 1}${data.statuses?.length ? "s" : "p"}`, data });
    },
    setFlag: async ({ value }) => void log.push(["flag", value]),
    notify: (level, key) => void log.push(["notify", key]),
  };
  return { deps, records, log };
}
const caster = { uuid: "Actor.c", name: "Testcaster" };
const spell = { uuid: "Actor.c.Item.s", name: "Testbolt", img: "i.png" };
const answer = { mode: "normal", picks: { g: "k" }, casterLevel: "3", situational: 2, visibility: "gm", pickKind: "beast", items: { "Scene.s.Token.k1": "w1" }, saveMod: true, targets: ["Scene.s.Token.k1", "Scene.s.Token.k2"], allocation: { bolt: { "Scene.s.Token.k1": "2", "Scene.s.Token.k2": "1" } } };
const combat = (over = {}) => ({ id: "k1", round: 2, turn: 0, turns: [{ id: "cb2" }, { id: "cb1" }], ...over });

await ta("a declaration writes a status-only casting record and a status-free pending record naming the answers and the lapse round, then sets the flag, and posts nothing", async () => {
  const w = world();
  const made = await declareCast({ caster, spell, answer, combat: combat(), combatant: { id: "cb1", initiative: 5 }, deps: w.deps });
  assert.equal(made.castId, "d1");
  assert.equal(made.round, 2, "the caster's turn is still to come this round");
  const [casting, pending] = w.records.map((r) => r.data);
  assert.deepEqual(casting.statuses, ["casting"]);
  assert.equal(pending.statuses, undefined);
  const read = spellEffectOf(pending);
  assert.deepEqual([read.castId, read.role, read.pending.spellUuid, read.pending.combatId, read.pending.at, read.pending.round], ["d1", "caster", spell.uuid, "k1", 77, 2]);
  assert.deepEqual([read.pending.mode, read.pending.picks, read.pending.casterLevel, read.pending.situational, read.pending.visibility, read.pending.pickKind, read.pending.items, read.pending.saveMod], ["normal", { g: "k" }, "3", 2, "gm", "beast", { "Scene.s.Token.k1": "w1" }, true]);
  assert.deepEqual(read.pending.targets, ["Scene.s.Token.k1", "Scene.s.Token.k2"], "the seat's targets at the answer are stored by token uuid");
  assert.deepEqual(read.pending.allocation, answer.allocation, "and so is the throw split");
  assert.deepEqual(w.log.map((l) => l[0]), ["create", "flag", "notify"]);
  assert.deepEqual(w.log[1], ["flag", true]);
});

t("the stored shape is one table: a declaration stores exactly ANSWER_FIELDS' keys, and reads back as the answer, with a record from before targets were stored read as having none recorded", () => {
  assert.deepEqual(Object.keys(answerStored(answer)), Object.keys(ANSWER_FIELDS));
  assert.deepEqual(Object.keys(answerStored(answer)).sort(), ["allocation", "casterLevel", "items", "mode", "pickKind", "picks", "saveMod", "situational", "targets", "visibility"]);
  const blank = answerStored({ mode: "normal" });
  assert.deepEqual([blank.targets, blank.allocation, blank.items, blank.visibility, blank.saveMod, blank.casterLevel], [[], {}, {}, "public", false, null]);
  const back = answerFromPending({ ...answerStored(answer), combatId: "k1", round: 2 });
  assert.deepEqual([back.targets, back.allocation, back.casterLevel, back.situational, back.pickKind, back.visibility], [answer.targets, answer.allocation, "3", 2, "beast", "gm"]);
  const old = answerFromPending({ spellUuid: "S", mode: "normal", picks: {}, casterLevel: null, situational: null, pickKind: null, combatId: "k1" });
  assert.deepEqual([old.targets, old.casterLevel, old.situational, old.pickKind, old.visibility], [null, "", "", null, "public"], "no targets recorded reads as null, which resolves on the seat as it stands");
  assert.deepEqual(answerFromPending({ ...answerStored({ mode: "normal" }), targets: [] }).targets, [], "a declaration of no target is an empty seat, not an unrecorded one");
});

await ta("a Judge's second declaration replaces the first: both of its records go before the new ones are written", async () => {
  const w = world();
  await declareCast({ caster, spell, answer, combat: combat(), combatant: { id: "cb1", initiative: 5 }, deps: w.deps });
  w.log.length = 0;
  await declareCast({ caster, spell, answer, combat: combat({ turn: 1 }), combatant: { id: "cb1", initiative: 5 }, deps: w.deps });
  assert.deepEqual(w.log.map((l) => l[0]), ["remove", "create", "flag", "notify"]);
  assert.equal(w.log[0].length - 1, 2, "the first declaration's casting and pending records");
  assert.equal(w.records.length, 2);
  assert.equal(spellEffectOf(w.records[1].data).castId, "d2");
});

await ta("ending a declaration clears the flag while the pending record stands, then deletes both records of it and none of another cast's", async () => {
  const w = world();
  await declareCast({ caster, spell, answer, combat: combat(), combatant: { id: "cb1", initiative: 5 }, deps: w.deps });
  await w.deps.create(caster, [{ statuses: [], flags: { "acks-extras": { spellEffect: { spellUuid: "S", castId: "other", casterUuid: "Actor.c", role: "caster" } } } }]);
  w.log.length = 0;
  const record = spellEffectOf(w.records[1].data);
  let standingAtFlag = null;
  w.deps.setFlag = async ({ value }) => {
    standingAtFlag = w.records.some((r) => spellEffectOf(r.data)?.pending);
    w.log.push(["flag", value]);
  };
  await endDeclaration({ caster, record, combat: combat(), combatant: { id: "cb1" }, deps: w.deps });
  assert.equal(standingAtFlag, true, "the flag is cleared first");
  assert.deepEqual(w.log.map((l) => l[0]), ["flag", "remove"]);
  assert.deepEqual(w.records.map((r) => spellEffectOf(r.data).castId), ["other"]);
  w.log.length = 0;
  await endDeclaration({ caster, record: { castId: "other", pending: {} }, deps: w.deps });
  assert.deepEqual(w.log.map((l) => l[0]), ["remove"], "with no fight there is no flag to clear");
});

await ta("losing the states casting stands for stamps each standing declaration lost with its cause and clears its flag; any other loss does nothing; a stamped one is not stamped twice", async () => {
  const w = world();
  await declareCast({ caster, spell, answer, combat: combat(), combatant: { id: "cb1", initiative: 5 }, deps: w.deps });
  const stamps = [];
  const deps = {
    ...w.deps,
    stamp: async (actor, id, lost) => {
      stamps.push([id, lost]);
      const r = w.records.find((x) => x.id === id);
      r.data.flags["acks-extras"].spellEffect.pending.lost = lost;
    },
    findFight: (combatId) => (combatId === "k1" ? { combat: combat(), combatant: { id: "cb1" } } : null),
  };
  assert.deepEqual(await onStatesLost(caster, ["concentrating"], "damage", deps), [], "a loss of other states");
  w.log.length = 0;
  const stamped = await onStatesLost(caster, ["casting"], "damage", deps);
  assert.equal(stamped.length, 1);
  assert.deepEqual(stamps, [["e2p", { cause: "damage", at: 77 }]]);
  assert.deepEqual(w.log, [["flag", false]]);
  assert.equal(spellEffectOf(w.records[1].data).pending.lost.cause, "damage");
  assert.deepEqual(await onStatesLost(caster, ["casting"], "save", deps), [], "already lost");
});

console.log(`\n${n} cast-declare tests passed`);
