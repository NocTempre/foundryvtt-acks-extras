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

const { lapseRound, turnEnded, staleDeclarations, checkDeclareFlagRequest, declareCast, endDeclaration, onStatesLost, ANSWER_FIELDS, answerStored, answerFromPending, lostItemPlan, checkLostItemRequest, stripLostItem, registerCastDeclare } = await import("../scripts/magic/cast-declare.mjs");
const { LOST_ITEM_HANDLER } = await import("../scripts/magic/constants.mjs");
const { castMoment, declarationOf, MOMENT } = await import("../scripts/magic/cast-moment.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { declaredFightOf, fightPhrase, declarationShown } = await import("../scripts/magic/declared-fight.mjs");

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
const answer = { mode: "normal", picks: { g: "k" }, casterLevel: "3", invocationLevel: 4, situational: 2, visibility: "gm", pickKind: "beast", items: { "Scene.s.Token.k1": "w1" }, saveMod: true, targets: ["Scene.s.Token.k1", "Scene.s.Token.k2"], allocation: { bolt: { "Scene.s.Token.k1": "2", "Scene.s.Token.k2": "1" } } };
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
  assert.equal(read.pending.declaredRound, 2, "the round the cast was declared in is stored beside the round it lapses in");
  const later = world();
  await declareCast({ caster, spell, answer, combat: combat({ turn: 1, round: 3 }), combatant: { id: "cb1", initiative: 5 }, deps: later.deps });
  const stored = spellEffectOf(later.records[1].data).pending;
  assert.deepEqual([stored.declaredRound, stored.round], [3, 4], "declared in round 3 after the caster's turn, lapsing in round 4");
  assert.equal(read.pending.invocationLevel, 4, "the invocation level is stored in the pending record");
  assert.deepEqual(read.pending.targets, ["Scene.s.Token.k1", "Scene.s.Token.k2"], "the seat's targets at the answer are stored by token uuid");
  assert.deepEqual(read.pending.allocation, answer.allocation, "and so is the throw split");
  assert.deepEqual(w.log.map((l) => l[0]), ["create", "flag", "notify"]);
  assert.deepEqual(w.log[1], ["flag", true]);
});

t("the stored shape is one table: a declaration stores exactly ANSWER_FIELDS' keys, and reads back as the answer, with a record from before targets were stored read as having none recorded", () => {
  assert.deepEqual(Object.keys(answerStored(answer)), Object.keys(ANSWER_FIELDS));
  assert.deepEqual(Object.keys(answerStored(answer)).sort(), ["allocation", "casterLevel", "invocationLevel", "items", "mode", "pickKind", "picks", "procedure", "procedureKind", "saveMod", "situational", "summon", "targets", "tradition", "visibility"]);
  const blank = answerStored({ mode: "normal" });
  assert.equal(blank.tradition, null, "an answer that names no tradition stores none");
  assert.deepEqual([answerStored({ tradition: "wisp" }).tradition, answerStored({ tradition: "" }).tradition, answerStored({ tradition: 4 }).tradition], ["wisp", null, null], "a tradition is a key or nothing");
  assert.equal(answerFromPending({ ...answerStored({ mode: "normal", tradition: "wisp" }), targets: [] }).tradition, "wisp", "the stored tradition reads back as the answer's");
  assert.equal(answerFromPending({ spellUuid: "S", mode: "normal", picks: {}, combatId: "k1" }).tradition, null, "a record stored before it holds none and resolves as it did");
  assert.equal(blank.invocationLevel, null, "no invocation level answered is stored as none");
  assert.deepEqual([blank.targets, blank.allocation, blank.items, blank.visibility, blank.saveMod, blank.casterLevel], [[], {}, {}, "public", false, null]);
  const back = answerFromPending({ ...answerStored(answer), combatId: "k1", round: 2 });
  assert.deepEqual([back.targets, back.allocation, back.casterLevel, back.situational, back.pickKind, back.visibility], [answer.targets, answer.allocation, "3", 2, "beast", "gm"]);
  assert.equal(back.invocationLevel, 4, "the stored invocation level reads back as the answer");
  assert.deepEqual([answerStored({ invocationLevel: "3" }).invocationLevel, answerStored({ invocationLevel: 0 }).invocationLevel, answerStored({ invocationLevel: 2.5 }).invocationLevel, answerStored({ invocationLevel: "x" }).invocationLevel], [3, null, null, null], "it is a whole number from one up, digits read as one, and nothing else");
  const old = answerFromPending({ spellUuid: "S", mode: "normal", picks: {}, casterLevel: null, situational: null, pickKind: null, combatId: "k1" });
  assert.deepEqual([old.targets, old.casterLevel, old.situational, old.pickKind, old.visibility], [null, "", "", null, "public"], "no targets recorded reads as null, which resolves on the seat as it stands");
  assert.deepEqual(answerFromPending({ ...answerStored({ mode: "normal" }), targets: [] }).targets, [], "a declaration of no target is an empty seat, not an unrecorded one");
});

await ta("a declaration stores the tradition the cast was pressed under, and a cast that named none stores none", async () => {
  const through = world();
  await declareCast({ caster, spell, answer: { ...answer, tradition: "wisp" }, combat: combat(), combatant: { id: "cb1", initiative: 5 }, deps: through.deps });
  assert.equal(spellEffectOf(through.records[1].data).pending.tradition, "wisp");
  const bare = world();
  await declareCast({ caster, spell, answer, combat: combat(), combatant: { id: "cb1", initiative: 5 }, deps: bare.deps });
  assert.equal(spellEffectOf(bare.records[1].data).pending.tradition, null);
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

t("the fight a declaration names: its scene, a fight with no scene, a record with no round, and a fight no document answers", () => {
  const fights = { k1: { round: 2, scene: { name: "Testyard" } }, k2: { round: 1, scene: null }, k3: { round: 1, scene: { name: "  " } } };
  const lookups = { combatOf: (id) => fights[id] ?? null };
  assert.deepEqual(declaredFightOf({ combatId: "k1", declaredRound: 2 }, lookups), { state: "scene", scene: "Testyard", round: 2 });
  assert.deepEqual(declaredFightOf({ combatId: "k2", declaredRound: 1 }, lookups), { state: "noScene", scene: "", round: 1 }, "a fight on no scene");
  assert.equal(declaredFightOf({ combatId: "k3", declaredRound: 1 }, lookups).state, "noScene", "a blank scene name is no scene");
  assert.deepEqual(declaredFightOf({ combatId: "k1" }, lookups), { state: "scene", scene: "Testyard", round: null }, "an older record has no round");
  assert.equal(declaredFightOf({ combatId: "k1", declaredRound: 0 }, lookups).round, null, "a fight's rounds count from one");
  assert.equal(declaredFightOf({ combatId: "k1", declaredRound: "2" }, lookups).round, null, "a round is a stored number");
  assert.deepEqual(declaredFightOf({ combatId: "k9", declaredRound: 4 }, lookups), { state: "gone", scene: "", round: 4 }, "no fight answers its id");
  assert.equal(declaredFightOf({}, lookups).state, "gone");
  const named = { combatOf: () => ({ scene: { name: "Vault", navName: "Testyard gate" } }) };
  assert.equal(declaredFightOf({ combatId: "k1" }, named).scene, "Testyard gate", "a scene's navigation name stands for its name");
  const say = (key, data) => `${key}|${JSON.stringify(data)}`;
  assert.equal(fightPhrase({ state: "scene", scene: "Testyard", round: 2 }, say), 'fightOnRound|{"scene":"Testyard","round":2}');
  assert.equal(fightPhrase({ state: "scene", scene: "Testyard", round: null }, say), 'fightOn|{"scene":"Testyard","round":""}');
  assert.equal(fightPhrase({ state: "noScene", scene: "", round: 3 }, say), 'fightNoSceneRound|{"round":3}');
  assert.equal(fightPhrase({ state: "noScene", scene: "", round: null }, say), 'fightNoScene|{"round":""}');
  assert.deepEqual([fightPhrase({ state: "gone", scene: "", round: 2 }, say), fightPhrase(null, say)], ["", ""], "no fight, no phrase");
});

t("a spell's row shows its latest declaration that is not lost, whatever round its fight has reached, and a fight that is gone does not hide it", () => {
  const fights = { k1: { round: 2, scene: { name: "Testyard" } } };
  const lookups = { combatOf: (id) => fights[id] ?? null };
  const rec = (castId, over = {}) => ({ castId, pending: { spellUuid: "S1", combatId: "k1", round: 2, declaredRound: 2, at: 10, ...over } });
  assert.equal(declarationShown([rec("a")], "S2", lookups), null, "another spell's");
  assert.equal(declarationShown([rec("a", { lost: { cause: "damage", at: 11 } })], "S1", lookups), null, "a lost declaration is waiting for nothing");
  const resolvable = declarationOf([rec("a", { round: 1 })], { spellUuid: "S1", combatId: "k1" }).valid;
  assert.equal(declarationShown([rec("a", { round: 1 })], "S1", lookups)?.record.castId, resolvable.castId, "a record the cast would still resolve shows, even with its fight past the round it lapses in (the caster's turn has not ended)");
  const early = { k1: { round: 1, scene: { name: "Testyard" } } };
  assert.equal(declarationShown([rec("a", { round: 0, declaredRound: 0 })], "S1", { combatOf: (id) => early[id] ?? null })?.fight.round, null, "declared before round one: the round is unknown, the row stays");
  assert.deepEqual(declarationShown([rec("a"), rec("b", { at: 20 })], "S1", lookups).record.castId, "b", "the latest of two");
  const gone = declarationShown([rec("a", { combatId: "k9" })], "S1", lookups);
  assert.deepEqual([gone.record.castId, gone.fight.state, gone.fight.round], ["a", "gone", 2], "the row still shows, naming no fight");
  assert.equal(declarationShown([rec("a", { declaredRound: undefined })], "S1", lookups).fight.round, null, "an older record shows the fight without a round");
  assert.equal(declarationShown([{ castId: "x" }, null], "S1", lookups), null);
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

/* ------------------------------------------------------------------ */
/*  A lost item leaves the answers that name it                       */
/* ------------------------------------------------------------------ */

const kit = (...uuids) => ({ kit: uuids.map((uuid) => ({ uuid, qty: 1, fit: "" })) });
const uuidsOf = (buckets) => Object.fromEntries(Object.entries(buckets).map(([key, list]) => [key, list.map((e) => e.uuid)]));
const recordOf = (id, buckets, extra = {}) => ({ id, record: { castId: id, role: "caster", pending: { spellUuid: "S", procedure: { buckets }, ...extra } } });

t("the strip's plan lists each pending answer that names the item, with its buckets as they stand without it, every bucket keeping its key; a record that names it nowhere, or holds no procedure, is left out", () => {
  const plan = lostItemPlan("Actor.a.Item.1", [
    recordOf("e1", { ...kit("Actor.a.Item.1", "Actor.a.Item.2"), other: [{ uuid: "Actor.a.Item.1", qty: 1, fit: "" }] }),
    recordOf("e2", kit("Actor.a.Item.2")),
    { id: "e3", record: { castId: "e3", role: "caster", pending: { spellUuid: "S" } } },
    { id: "e4", record: { castId: "e4", role: "caster" } },
  ]);
  assert.deepEqual(plan.map((step) => step.id), ["e1"]);
  assert.deepEqual(uuidsOf(plan[0].buckets), { kit: ["Actor.a.Item.2"], other: [] }, "the emptied bucket keeps its key, so a write that merges objects still lands");
  assert.deepEqual(lostItemPlan("Actor.a.Item.9", [recordOf("e1", kit("Actor.a.Item.1"))]), [], "an item no answer names plans nothing");
  assert.deepEqual(lostItemPlan("", [recordOf("e1", kit("Actor.a.Item.1"))]), []);
});

t("a relayed strip is checked on the fact, not on who asks: no item is refused, and so is one that still stands", () => {
  assert.deepEqual(checkLostItemRequest({}, { gone: true }), { refused: "noItem" });
  assert.deepEqual(checkLostItemRequest({ itemUuid: "I.1" }, { gone: false }), { refused: "present" });
  assert.deepEqual(checkLostItemRequest({ itemUuid: "I.1", requestUserId: "u9" }, { gone: true }), { ok: true });
});

await ta("a strip writes the records this client may write and asks the GM's client, once, for the rest; with no GM to ask the rest stay and the cast's own resolve drops them", async () => {
  const records = [recordOf("w", kit("I.1")), recordOf("r1", kit("I.1")), recordOf("r2", kit("I.1", "I.2")), recordOf("n", kit("I.2"))];
  const wrote = [];
  const asked = [];
  const deps = (over = {}) => ({
    records: async () => records,
    canWrite: (step) => step.id === "w",
    write: async (step) => void wrote.push([step.id, uuidsOf(step.buckets)]),
    relay: async (req) => (asked.push(req), { ok: true }),
    ...over,
  });
  const done = await stripLostItem("I.1", deps());
  assert.deepEqual(wrote, [["w", { kit: [] }]]);
  assert.deepEqual(asked, [{ itemUuid: "I.1" }], "one request for every record this client could not write");
  assert.deepEqual([done.written, done.relayed, done.failed], [["w"], ["r1", "r2"], []]);
  const alone = await stripLostItem("I.1", deps({ relay: async () => null }));
  assert.deepEqual([alone.written, alone.relayed], [["w"], []], "no GM answered: nothing is relayed");
  wrote.length = 0;
  asked.length = 0;
  const none = await stripLostItem("I.9", deps());
  assert.deepEqual([none.written, none.relayed, wrote.length, asked.length], [[], [], 0, 0], "an item no answer names writes and asks nothing");
  const logged = console.error;
  console.error = () => {};
  const failing = await stripLostItem("I.1", deps({ write: async () => { throw new Error("refused"); } }));
  console.error = logged;
  assert.deepEqual(failing.failed, ["w"], "a write that throws is logged and reported, and the rest go on");
});

/** One pending record as an effect document the live hooks read and write. */
function effectDoc(id, buckets, writable = true) {
  const e = {
    id,
    flags: { "acks-extras": { spellEffect: { castId: id, role: "caster", spellUuid: "S", pending: { spellUuid: "S", procedure: { buckets } } } } },
    writes: 0,
    canUserModify: () => writable,
    update: async (patch) => {
      for (const [path, value] of Object.entries(patch)) {
        const keys = path.split(".");
        const last = keys.pop();
        keys.reduce((o, k) => o[k], e)[last] = value;
        e.writes++;
      }
    },
  };
  return e;
}
const bucketsOf = (e) => uuidsOf(e.flags["acks-extras"].spellEffect.pending.procedure.buckets);

await ta("the live hooks strike a deleted item, and an emptied stack, from every pending answer on the client that made the change, idempotently and with no ownership gate; a move to another holder is a delete, and the new uuid stays", async () => {
  const hooks = {};
  const emitted = [];
  const mine = effectDoc("mine", kit("Actor.a.Item.1", "Actor.b.Item.1"));
  const other = effectDoc("other", kit("Actor.a.Item.1"), false);
  const bystander = effectDoc("bystander", kit("Actor.a.Item.2"));
  const actorOf = (...effects) => ({ effects: { get: (id) => effects.find((e) => e.id === id), [Symbol.iterator]: () => effects[Symbol.iterator]() } });
  Object.assign(globalThis.game, { user: { id: "u1", isGM: false }, users: { activeGM: { id: "gm" } }, actors: [actorOf(mine, bystander), actorOf(other)], scenes: [], socket: { emit: (channel, msg) => emitted.push(msg) } });
  globalThis.Hooks = { on: (name, fn) => (hooks[name] = fn), once() {}, callAll() {} };
  let held = null;
  globalThis.fromUuidSync = () => held;
  registerCastDeclare();
  const settle = () => new Promise((r) => setTimeout(r, 30));
  const item = (uuid, quantity) => ({ uuid, system: quantity === undefined ? {} : { quantity } });

  hooks.deleteItem(item("Actor.a.Item.1"), {}, "u2");
  await settle();
  assert.deepEqual([bucketsOf(mine), mine.writes], [{ kit: ["Actor.a.Item.1", "Actor.b.Item.1"] }, 0], "another user's delete is that client's to strip");
  hooks.deleteItem(item("Actor.a.Item.1"), {}, "u1");
  await settle();
  assert.deepEqual(bucketsOf(mine), { kit: ["Actor.b.Item.1"] }, "a seat that is no GM writes the record it may write");
  assert.deepEqual(bucketsOf(other), { kit: ["Actor.a.Item.1"] }, "and cannot write the other");
  assert.deepEqual(emitted.map((m) => [m.action, m.payload]), [[LOST_ITEM_HANDLER, { itemUuid: "Actor.a.Item.1" }]], "which it asks the GM's client for, once");
  assert.deepEqual(bucketsOf(bystander), { kit: ["Actor.a.Item.2"] }, "a record that never named it is untouched");
  const writes = mine.writes;
  hooks.deleteItem(item("Actor.a.Item.1"), {}, "u1");
  await settle();
  assert.equal(mine.writes, writes, "a second strip of the same uuid writes nothing");
  hooks.deleteItem(item("Actor.z.Item.9"), {}, "u1");
  await settle();
  assert.equal(mine.writes, writes, "a uuid no answer names writes nothing");

  // A stack with something left leaves nothing; an emptied one is off the holder, and what a holder is given in its place is another uuid.
  hooks.updateItem(item("Actor.b.Item.1", 2), { system: { quantity: 2 } }, {}, "u1");
  await settle();
  assert.deepEqual(bucketsOf(mine), { kit: ["Actor.b.Item.1"] }, "a stack with stock left stays in the answer");
  hooks.updateItem(item("Actor.b.Item.1", 0), { system: { quantity: 0 } }, {}, "u1");
  await settle();
  assert.deepEqual(bucketsOf(mine), { kit: [] }, "an emptied stack leaves it");
  hooks.updateItem(item("Actor.a.Item.2", 0), { system: { quantity: 0 } }, {}, "u2");
  await settle();
  assert.deepEqual(bucketsOf(bystander), { kit: ["Actor.a.Item.2"] }, "an emptied stack on another client's write is that client's");
  const moved = effectDoc("moved", kit("Actor.a.Item.5", "Actor.b.Item.5"));
  globalThis.game.actors.push(actorOf(moved));
  hooks.deleteItem(item("Actor.a.Item.5"), {}, "u1");
  await settle();
  assert.deepEqual(bucketsOf(moved), { kit: ["Actor.b.Item.5"] }, "the item a move made on its new holder is a different uuid and stays");

  // The GM's client re-reads the world and strikes the records the seat could not write, only for an item that has gone.
  const { executeAsGM } = await import("../scripts/lib/sockets.mjs");
  globalThis.game.user.isGM = true;
  held = { uuid: "Actor.a.Item.1", system: { quantity: 3 } };
  assert.deepEqual(await executeAsGM(LOST_ITEM_HANDLER, { itemUuid: "Actor.a.Item.1" }), { ok: false, reason: "present" });
  assert.deepEqual(bucketsOf(other), { kit: ["Actor.a.Item.1"] }, "an item that still stands is not struck");
  assert.deepEqual(await executeAsGM(LOST_ITEM_HANDLER, { itemUuid: "" }), { ok: false, reason: "noItem" });
  held = { uuid: "Actor.a.Item.1", system: { quantity: 0 } };
  const result = await executeAsGM(LOST_ITEM_HANDLER, { itemUuid: "Actor.a.Item.1" });
  assert.equal(result.ok, true, "a stack left empty is off the holder");
  assert.deepEqual(bucketsOf(other), { kit: [] }, "the GM's client writes the record the seat could not");
  assert.deepEqual((await executeAsGM(LOST_ITEM_HANDLER, { itemUuid: "Actor.a.Item.1" })).written, [], "and a repeat finds nothing");
  const other2 = effectDoc("other2", kit("Actor.a.Item.7"), false);
  globalThis.game.actors.push(actorOf(other2));
  held = null;
  assert.equal((await executeAsGM(LOST_ITEM_HANDLER, { itemUuid: "Actor.a.Item.7" })).ok, true, "an item that is no longer there is struck too");
  assert.deepEqual(bucketsOf(other2), { kit: [] });
});

console.log(`\n${n} cast-declare tests passed`);
