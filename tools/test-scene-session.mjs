/**
 * Scene search's Foundry side over a fake world: the lib writes a place's things
 * take (remove, reset), the player projection, the session record, the two
 * turn-plan activities and what each refusal does, resolution (the roll, the
 * state, the lock, the lots, the reveal, the log), the Round press's seam in
 * both of its paths, and the session api. Every name, letter and figure here is
 * this file's own invention; no throw target stands for any printed one.
 */
import assert from "node:assert/strict";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

/* ---------------- the fake world ---------------- */

class ForcedReplacement {
  constructor(value) {
    this.value = value;
  }
  static create(value) {
    return new ForcedReplacement(value);
  }
}
class ForcedDeletion {}
const setPath = (target, path, value) => {
  const keys = path.split(".");
  let at = target;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  if (value instanceof ForcedDeletion) delete at[keys.at(-1)];
  else at[keys.at(-1)] = value instanceof ForcedReplacement ? structuredClone(value.value) : structuredClone(value);
};
const docOf = (extra) => ({
  flags: {},
  writes: 0,
  getFlag(scope, key) {
    return this.flags?.[scope]?.[key];
  },
  async update(changes) {
    this.writes++;
    for (const [path, value] of Object.entries(changes)) setPath(this, path, value);
  },
  ...extra,
});
const itemsOf = (list) => { const arr = [...list]; Object.defineProperty(arr, "contents", { get: () => [...arr] }); return arr; };
const ability = (provides) => ({ type: "ability", flags: {}, getFlag: (_s, key) => (key === "extras" ? { provides: [provides] } : undefined) });
const actorOf = (id, { level = 1, abilities = [], items = [] } = {}) =>
  docOf({ id, uuid: `Actor.${id}`, documentName: "Actor", type: "character", name: id.toUpperCase(), system: { details: { level } }, items: itemsOf([...abilities.map(ability), ...items]) });

class CardMap extends Map {
  get contents() {
    return [...this.values()];
  }
}
const piles = [];
const pileOf = (id) => ({
  ...docOf({ id, uuid: `Cards.${id}`, documentName: "Cards", type: "pile", name: "", ownership: {}, cards: new CardMap() }),
  async createEmbeddedDocuments(_kind, data) {
    return data.map((d) => {
      const card = { id: `c${this.cards.size + 1}`, ...structuredClone(d) };
      this.cards.set(card.id, card);
      return card;
    });
  },
  async updateEmbeddedDocuments(_kind, updates) {
    for (const { _id, ...rest } of updates) for (const [path, value] of Object.entries(rest)) setPath(this.cards.get(_id), path, value);
  },
  async deleteEmbeddedDocuments(_kind, ids) {
    for (const cid of ids) this.cards.delete(cid);
  },
  async delete() {},
});

const THINGS = "flags.acks-extras.things";
const place = docOf({ id: "place1", uuid: "Actor.place1", documentName: "Actor", type: "acks-extras.location", name: "The cellar" });
const party = docOf({ id: "party1", uuid: "Actor.party1", documentName: "Actor", type: "party", name: "Party" });
const members = {
  a1: actorOf("a1", { level: 2, abilities: ["kw:searching"] }),
  a2: actorOf("a2", { level: 1 }),
  a3: actorOf("a3", { level: 1, items: [{ uuid: "Item.own", _stats: { compendiumSource: "Item.crowbar" }, flags: {} }] }),
};
const scene = { id: "s1", grid: { size: 100, distance: 5, units: "ft" }, tokens: new Map(), walls: new Map([["w9", { id: "w9" }]]) };
scene.tokens.set("t1", { id: "t1", x: 0, y: 0, width: 1, height: 1, parent: scene });
const formationRecord = () => ({ id: "f1", name: "Party", actorId: "party1", sceneId: "s1", tokenId: "t1", stance: {}, clock: { turnsTotal: 3 }, members: Object.keys(members).map((actorId) => ({ actorId })) });

const user = { id: "j1", isGM: true };
const messages = new Map();
globalThis.game = {
  user,
  users: { filter: () => [{ id: "j1", isGM: true }, { id: "p1", isGM: false }], activeGM: user },
  i18n: { lang: "en", localize: (key) => key, format: (key) => key, has: () => true },
  items: { find: () => undefined },
  actors: { get: (id) => [place, party, ...Object.values(members)].find((a) => a.id === id), filter: () => [] },
  scenes: { get: (id) => (id === "s1" ? scene : undefined) },
  cards: { get: (id) => piles.find((p) => p.id === id) },
  messages: { get: (id) => messages.get(id) },
  settings: { get: () => ({ f1: formationRecord() }) },
  packs: [],
};
globalThis.fromUuidSync = (uuid) => (uuid === place.uuid ? place : uuid === party.uuid ? party : piles.find((p) => p.uuid === uuid) ?? null);
globalThis.CONFIG = { Dice: { randomUniform: () => 0.5 } };
globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OWNER: 3 } };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.ChatMessage = { create: async () => ({ id: "msg" }), getWhisperRecipients: () => [] };
globalThis.foundry = {
  dice: { MersenneTwister: { random: () => 0.5 } },
  documents: { Cards: { implementation: { create: async (data) => { const pile = Object.assign(pileOf(`pot${piles.length + 1}`), data); piles.push(pile); return pile; } } } },
  data: { operators: { ForcedReplacement, ForcedDeletion } },
  utils: { escapeHTML: (s) => String(s), deepClone: (v) => structuredClone(v) },
};

const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
const { THING_KINDS } = await import("../scripts/lib/place-things-logic.mjs");
const { addThingTo, removeThingFrom, resetThingIn, thingsOf, updateThingOn } = await import("../scripts/lib/place-things.mjs");
const C = await import("../scripts/scene-search/constants.mjs");
const { CODE, REFUSAL, SESSION_REFUSAL, ACTIVITY, SESSION_FLAG } = C;
const SL = await import("../scripts/scene-search/scene-logic.mjs");
const SJ = await import("../scripts/scene-search/session-logic.mjs");
const S = await import("../scripts/scene-search/session.mjs");
const A = await import("../scripts/scene-search/activities.mjs");
const { createSceneSearchApi } = await import("../scripts/scene-search/api.mjs");
const { resolveSceneRound, dueRoundEntries } = await import("../scripts/scene-search/round.mjs");
const { revealExit } = await import("../scripts/scene-search/seams.mjs");
const { offeredActivities, lockActivity, resolveDue, turnActivity } = await import("../scripts/lib/turn-activities.mjs");
const { normalizeTruth } = await import("../scripts/treasure/pot-logic.mjs");
const { viewOf } = await import("../scripts/treasure/pot.mjs");
const { POT_FLAG } = await import("../scripts/treasure/constants.mjs");
const tables = await import("../scripts/lib/tables.mjs");
const { FORMATION_DOC } = await import("../scripts/formation/constants.mjs");

const truth = (label) => normalizeTruth({ pool: "item", label, weight6: 1 });
const things = () => thingsOf(place);
const stored = () => place.flags[MODULE_ID].things;
const layer = (over) => over;
const base = (id, kind, over = {}) => ({ id, kind, ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {}, ...over });
const LIST = [
  base("thing-1", THING_KINDS.CONTAINER),
  base("thing-2", THING_KINDS.FLOOR),
  base("thing-3", THING_KINDS.FIXTURE, { hint: "Look closer", layers: { hasty: layer({ check: "inspect", yields: { clue: "A subject" } }), methodical: layer({ check: "search", yields: { reveal: ["thing:thing-4"] } }) } }),
  base("thing-4", THING_KINDS.CONTAINER, { hidden: true }),
  base("thing-5", THING_KINDS.EXIT, { layers: { methodical: layer({ check: "search", yields: { reveal: ["wall:w9"] } }) } }),
  base("thing-6", THING_KINDS.CONTAINER, { point: { x: 100000, y: 0 } }),
  base("thing-7", THING_KINDS.CONTAINER, { layers: { methodical: layer({ check: "search", tools: ["Item.crowbar"] }) } }),
];
const reset = async () => {
  await place.update({ [THINGS]: ForcedReplacement.create(structuredClone(LIST)) });
  await party.update({ [`flags.${MODULE_ID}.${SESSION_FLAG}`]: new ForcedDeletion(), [`flags.${MODULE_ID}.turnPlan`]: new ForcedDeletion() });
  place.writes = 0;
};

/* ---------------- lib: remove and reset ---------------- */
{
  await reset();
  const gone = await removeThingFrom(place, "thing-2");
  eq([gone.length, things().some((t) => t.id === "thing-2"), stored().length], [6, false, 6], "a removed thing is gone from the stored list");
  eq(await removeThingFrom(place, "nope"), null, "an id the place does not hold writes nothing");
  eq(place.writes, 1, "and the refused remove made no write");
  user.isGM = false;
  eq([await removeThingFrom(place, "thing-1"), await resetThingIn(place, "thing-1")], [null, null], "a player's client removes and resets nothing");
  user.isGM = true;
  eq(things().length, 6, "and the list stands");

  await reset();
  await updateThingOn(place, "thing-6", { state: { shown: true, layers: { hasty: { done: true } } } });
  const before = things().find((t) => t.id === "thing-6");
  const cleared = await resetThingIn(place, "thing-6");
  const after = cleared.find((t) => t.id === "thing-6");
  eq([after.state, after.point, after.kind], [{}, before.point, before.kind], "a Reset clears the state and leaves what was authored");
  eq(things().find((t) => t.id === "thing-1"), base("thing-1", THING_KINDS.CONTAINER), "and every other thing is untouched");
  eq(await resetThingIn(place, "nope"), null, "an id the place does not hold resets nothing");
}

/* ---------------- the player projection ---------------- */
{
  const entries = SJ.sessionEntries({
    things: LIST,
    session: { bodies: [], lots: [{ key: "thing:thing-1/1", thing: "thing:thing-1", layer: "methodical", cardId: "c1" }] },
  });
  const one = entries.find((e) => e.key === "thing:thing-1");
  eq(one.layers.methodical.yields.lots, ["thing:thing-1/1"], "the session's lot is laid over the entry's layer");
  eq(LIST[0].layers, {}, "and the place's authored list is not written with it");

  const seen = SL.playerView(entries);
  const chest = seen.find((e) => e.key === "thing:thing-1");
  eq([chest.layers.methodical.yields.lots, chest.moreRemains, chest.more], [[], true, ["lots"]], "a player's unfound lots are stripped but the mark that more remains stays");
  const statue = seen.find((e) => e.key === "thing:thing-3");
  eq([statue.layers.hasty.yields.clue, statue.layers.methodical.yields.reveal, statue.more, statue.hint], [null, [], ["clue", "reveal"], "Look closer"], "an unfound clue and reveal are stripped, the kinds named and the hint shown");
  ok(!seen.some((e) => e.key === "thing:thing-4"), "a hidden entry behind an unsolved clue is absent");
  eq(seen.find((e) => e.key === "thing:thing-2").hint, null, "an entry with nothing more carries no hint");

  const found = structuredClone(entries);
  found.find((e) => e.key === "thing:thing-3").state = { layers: { hasty: { done: true, found: true } } };
  const after = SL.playerView(found).find((e) => e.key === "thing:thing-3");
  eq([after.layers.hasty.yields.clue, after.layers.methodical.yields.reveal], ["A subject", []], "a found layer keeps what it yielded while an unfound one stays stripped");
  const solved = structuredClone(found);
  solved.find((e) => e.key === "thing:thing-3").state = { layers: { hasty: { done: true, found: true }, methodical: { done: true, found: true } } };
  const done = SL.playerView(solved).find((e) => e.key === "thing:thing-3");
  eq([done.hint, done.more, done.moreRemains], [null, [], false], "the Judge's hint goes once nothing more remains");
  eq(entries.find((e) => e.key === "thing:thing-3").layers.hasty.yields.clue, "A subject", "the projection never touches its input");
  eq(SL.sceneView(entries, { isGM: true }).find((e) => e.key === "thing:thing-3").layers.hasty.yields.clue, "A subject", "the Judge's view keeps every yield");
}

/* ---------------- the session record ---------------- */
{
  eq(SJ.normalizeSession(null), null, "no session is null");
  eq(SJ.normalizeSession({ sceneId: "s1" }), null, "a session with no place is none");
  const s = SJ.normalizeSession({ placeUuid: "Actor.place1", bodies: [{ id: "b1" }, { id: "b1" }, { nope: 1 }], lots: [{ key: "k", thing: "body:b1", layer: "weird" }, { key: "" }], log: [{ a: 1 }, "x"] });
  eq([s.bodies.length, s.lots, s.log.length, s.potUuid, s.recordMessageId], [1, [{ key: "k", thing: "body:b1", layer: "hasty", cardId: null }], 1, null, null], "bodies, lots and the log are cleaned and every key is present");
  const { bodies, sources } = SJ.bodiesFromRecord({ fallen: [{ combatantId: "c1", name: "Ogre", actorUuid: "Actor.ogre", letter: null, goods: [{ itemId: "i1", truths: [truth("Ladle")] }] }, { combatantId: "c2", goods: [] }, { name: "no id" }] });
  eq([bodies.map((b) => b.id), sources.map((x) => [x.thing, x.layer, x.truths.length])], [["c1", "c2"], [["body:c1", "hasty", 1]]], "a record's fallen become bodies, and a source keyed to each body that carries something");
}

/* ---------------- applying one check ---------------- */
const PLAIN = { id: "a2", level: 1, capabilities: [], tools: [] };
const THIEF = { id: "a1", level: 2, capabilities: [C.CAPABILITY.SEARCHING], tools: [] };
const FIG = { hastyTarget: 14, methodicalTarget: 16, searchBonus: null, skillTargets: {} };
{
  const entries = SJ.sessionEntries({ things: LIST, session: { bodies: [], lots: [{ key: "thing:thing-2/1", thing: "thing:thing-2", layer: "hasty", cardId: "c1" }] } });
  const ctx = { figures: FIG };
  const missed = SJ.applyCheck({ entries, key: "thing:thing-2", layer: "hasty", member: THIEF, ctx, roll: { passed: false } });
  eq([missed.outcome.code, missed.outcome.locks, missed.patch.layers.hasty.failed, missed.lots], [CODE.FOUND_NOTHING, true, { a1: 2 }, []], "a failed hasty throw records the lock at the character's level");
  const hit = SJ.applyCheck({ entries, key: "thing:thing-2", layer: "hasty", member: THIEF, ctx, roll: { passed: true } });
  eq([hit.outcome.code, hit.lots, hit.patch.layers.hasty.found], [CODE.FOUND, ["thing:thing-2/1"], true], "a passed throw finds the lot and marks the layer found");
  const second = structuredClone(entries);
  second.find((e) => e.key === "thing:thing-2").state = hit.patch;
  const late = SJ.applyCheck({ entries: second, key: "thing:thing-2", layer: "hasty", member: { ...THIEF, id: "a9" }, ctx, roll: { passed: false } });
  eq([late.outcome.refusal, late.patch, late.lots], [REFUSAL.ALREADY_FOUND, null, []], "a second searcher at an entry already found records no failure and no lock");
  const locked = structuredClone(entries);
  locked.find((e) => e.key === "thing:thing-2").state = missed.patch;
  eq(SJ.applyCheck({ entries: locked, key: "thing:thing-2", layer: "hasty", member: THIEF, ctx }).outcome.refusal, REFUSAL.HASTY_LOCKED, "the failed character is locked out of the hasty check");
  eq(SJ.applyCheck({ entries: locked, key: "thing:thing-2", layer: "hasty", member: { ...THIEF, level: 3 }, ctx, roll: { passed: true } }).outcome.code, CODE.FOUND, "and a level gained reopens it");
  const reveal = SJ.applyCheck({ entries, key: "thing:thing-3", layer: "methodical", member: PLAIN, ctx, roll: { passed: true } });
  eq([reveal.shown, reveal.patch.revealed], [["thing:thing-4"], ["thing:thing-4"]], "a found reveal shows the hidden entry and is recorded in the entry's state");
  const exit = SJ.applyCheck({ entries, key: "thing:thing-5", layer: "methodical", member: PLAIN, ctx, roll: { passed: true } });
  eq([exit.walls, exit.patch.revealed], [["w9"], ["wall:w9"]], "a found hidden exit names its wall and records it");
  eq(SJ.applyCheck({ entries, key: "thing:nope", layer: "hasty", member: THIEF, ctx }).outcome.refusal, SESSION_REFUSAL.UNKNOWN_ENTRY, "an entry the scene does not hold is refused");
  const row = SJ.logRowOf({ member: THIEF, key: "thing:thing-2", layer: "hasty", outcome: hit.outcome });
  ok(!JSON.stringify(row).match(/total|target|roll|die/i), "a log row holds no throw");
}

/* ---------------- the world: activities, resolution, the seams ---------------- */
tables.registerTable({ id: FORMATION_DOC, tables: { searchReachFeet: 10 } }, { priority: tables.PRIORITY.WORLD });
const dice = [];
const posted = [];
const revealed = [];
A.configureSceneChecks({
  checks: {
    PARTY_CHECKS: { searchHasty: { id: "hasty" }, searchMethodical: { id: "methodical" } },
    resolveCheck: (actor, cfg) => (cfg.id === "hasty" ? (actor.id === "a1" ? { target: 14 } : null) : cfg.id === "methodical" ? { target: 16 } : null),
    rollCheckFor: async (actor, cfg) => {
      const passed = dice.shift();
      return { roll: null, check: {}, row: { name: actor.name, total: passed ? 20 : 2, target: cfg.id === "hasty" ? 14 : 16, source: "src", sourceTip: "tip", success: passed } };
    },
  },
  postRoll: (card) => card.rolled && posted.push(card),
  reveal: (wall) => revealed.push(wall.id),
});
A.registerSceneActivities();
const formation = () => globalThis.game.settings.get().f1;
const fcall = (key, over = {}) => ({ actorId: "a1", actor: members.a1, key, ctx: { formation: formation() }, ...over });

{
  ok(!!turnActivity(ACTIVITY.HASTY) && !!turnActivity(ACTIVITY.METHODICAL), "both activities are registered");
  eq([turnActivity(ACTIVITY.HASTY).length, turnActivity(ACTIVITY.METHODICAL).length, turnActivity(ACTIVITY.HASTY).pace, turnActivity(ACTIVITY.METHODICAL).pace], ["round", "turn", "hasty", "methodical"], "a hasty check is a round and a methodical one a turn");
  await reset();
  eq(offeredActivities(members.a1, { formation: formation() }).filter((r) => r.key.startsWith("scene")), [], "with no session open nothing is offered");

  const opened = await createSceneSearchApi({ plan: {}, request: async () => null }).open({
    partyId: "f1",
    placeUuid: place.uuid,
    sceneId: "s1",
    metInLair: true,
    sources: [{ thing: "thing:thing-2", layer: "hasty", truths: [truth("Spoon")] }, { thing: "thing:thing-1", layer: "methodical", truths: [truth("Ladle")] }],
  });
  eq([opened.ok, S.readSession(formation()).lots.map((l) => [l.key, l.thing, l.layer])], [true, [["thing:thing-2/1", "thing:thing-2", "hasty"], ["thing:thing-1/1", "thing:thing-1", "methodical"]]], "a session opens with each dealt lot keyed to its entry");
  eq(things().find((t) => t.id === "thing-2").layers, {}, "the place's authored list holds no lot key");
  const pot = piles.at(-1);
  eq(pot.flags[MODULE_ID][POT_FLAG].partyId, "f1", "the pot answers to the party");

  const rows = offeredActivities(members.a1, { formation: formation() }).filter((r) => r.key === ACTIVITY.HASTY);
  eq(rows.length, 7, "a member is offered the hasty check at every entry");
  eq(rows.every((r) => r.turns === 1), true, "each is one turn on the plan");

  // reach: a thing with a point far from the party is out of reach; nothing imported puts nothing out of reach
  const far = rows.find((r) => r.option.id === "thing:thing-6");
  eq(far.blocked?.reason, REFUSAL.OUT_OF_REACH, "a thing past the imported reach is refused");
  const near = rows.find((r) => r.option.id === "thing:thing-2");
  eq(near.blocked, null, "a thing with no point is the Judge's call, never refused");
  tables.unregisterTable(FORMATION_DOC);
  const unimported = offeredActivities(members.a1, { formation: formation() }).find((r) => r.key === ACTIVITY.HASTY && r.option.id === "thing:thing-6");
  eq(unimported.blocked, null, "with no reach imported nothing is out of reach by distance");
  tables.registerTable({ id: FORMATION_DOC, tables: { searchReachFeet: 10 } }, { priority: tables.PRIORITY.WORLD });
  const closer = structuredClone(LIST);
  closer.find((t) => t.id === "thing-6").point = { x: 100, y: 0 };
  await place.update({ [THINGS]: ForcedReplacement.create(closer) });
  eq(offeredActivities(members.a1, { formation: formation() }).find((r) => r.key === ACTIVITY.HASTY && r.option.id === "thing:thing-6").blocked, null, "a thing within the reach is in reach");
  await place.update({ [THINGS]: ForcedReplacement.create(structuredClone(LIST)) });

  // refusals through the lock
  const lock = (actorKey, actor, key, option) => lockActivity({}, { actorId: actorKey, actor, key, option, ctx: { formation: formation() } });
  eq(lock("a2", members.a2, ACTIVITY.METHODICAL, "thing:thing-7").reason, REFUSAL.TOOL_MISSING, "a check whose tool the member lacks is refused");
  eq(lock("a2", members.a2, ACTIVITY.METHODICAL, "thing:thing-7").missing, ["Item.crowbar"], "and names the tool");
  eq(lock("a3", members.a3, ACTIVITY.METHODICAL, "thing:thing-7").ok, true, "a member whose own item was made from the named tool holds it");
  eq(lock("a3", members.a3, ACTIVITY.METHODICAL, "thing:thing-1").ok, true, "a member with no tool need is accepted");
  eq(lock("a1", members.a1, ACTIVITY.HASTY, "thing:thing-9").reason, "unknownOption", "an entry that is not there is not an option");
  eq(lock("a1", members.a1, ACTIVITY.HASTY, "thing:thing-2").entry?.turns, 1, "a hasty lock is one turn on the plan");
}

/* ---------------- resolution ---------------- */
{
  const pile = piles.at(-1);
  const lots = () => viewOf(pile).cards.map((c) => [c.truth.lot, c.truth.found]);
  eq(lots(), [["thing:thing-2/1", false], ["thing:thing-1/1", false]], "every lot is dealt unfound");

  const vague = await A.resolveSceneCheck({ formation: formation(), actor: members.a2, key: "thing:thing-2", layer: "hasty" });
  eq([vague.ok, vague.outcome.code, posted.length], [true, CODE.VAGUE, 0], "a member without the searching capability gets only the hint at a hasty search, and nothing is rolled");
  dice.push(false);
  const miss = await A.resolveSceneCheck({ formation: formation(), actor: members.a1, key: "thing:thing-2", layer: "hasty" });
  eq([miss.ok, miss.outcome.code], [true, CODE.FOUND_NOTHING], "a failed hasty throw finds nothing");
  eq(things().find((t) => t.id === "thing-2").state.layers.hasty.failed, { a1: 2 }, "and locks that character at their level in the thing's own state");
  eq(lots()[0][1], false, "the lot stays unfound");
  const again = await A.resolveSceneCheck({ formation: formation(), actor: members.a1, key: "thing:thing-2", layer: "hasty" });
  eq([again.ok, again.reason], [false, REFUSAL.HASTY_LOCKED], "the same character cannot check hastily again at that level");
  eq(dice.length, 0, "and nothing was rolled for the refusal");
  eq(S.readSession(formation()).log.map((r) => r.code), [CODE.VAGUE, CODE.FOUND_NOTHING], "only answered checks are logged");
  ok(!JSON.stringify(S.readSession(formation()).log).match(/total|target|20|14/), "the table's log holds no figure");
  eq([posted.length, posted[0].rolled.row.total], [1, 2], "the throw went to the Judges' card");

  members.a1.system.details.level = 3;
  dice.push(true);
  const hit = await A.resolveSceneCheck({ formation: formation(), actor: members.a1, key: "thing:thing-2", layer: "hasty" });
  eq([hit.outcome.code, hit.lots.ids.length, lots()[0][1]], [CODE.FOUND, 1, true], "a passed throw finds the lot and marks its card found");
  const late = await A.resolveSceneCheck({ formation: formation(), actor: members.a2, key: "thing:thing-2", layer: "hasty" });
  eq([late.ok, late.reason], [false, REFUSAL.ALREADY_FOUND], "a second searcher at a found entry is refused");
  eq(things().find((t) => t.id === "thing-2").state.layers.hasty.failed, { a1: 2 }, "and no lock is recorded for them");

  // methodical finds the chest's lot; the hint kinds shrink
  dice.push(true);
  const chest = await A.resolveSceneCheck({ formation: formation(), actor: members.a2, key: "thing:thing-1", layer: "methodical" });
  eq([chest.outcome.code, lots()[1][1]], [CODE.FOUND, true], "a methodical check finds what the chest hides");

  // reveal and hidden exit
  dice.push(true);
  const statue = await A.resolveSceneCheck({ formation: formation(), actor: members.a2, key: "thing:thing-3", layer: "methodical" });
  eq([statue.outcome.code, things().find((t) => t.id === "thing-4").state.shown, things().find((t) => t.id === "thing-3").state.revealed], [CODE.FOUND, true, ["thing:thing-4"]], "a found reveal shows the hidden entry");
  dice.push(true);
  await A.resolveSceneCheck({ formation: formation(), actor: members.a2, key: "thing:thing-5", layer: "methodical" });
  eq([revealed, things().find((t) => t.id === "thing-5").state.revealed], [["w9"], ["wall:w9"]], "a hidden exit is recorded and the map's seam is told its wall");
  eq(await revealExit(scene, "w9"), false, "without the close-out's function the seam does nothing");
  eq(await revealExit(scene, "w9", { reveal: (wall) => revealed.push(`x${wall.id}`) }), true, "and with it, reveals the wall");
  eq(revealed.at(-1), "xw9", "through that function alone");

  // a player's client resolves nothing
  user.isGM = false;
  eq((await A.resolveSceneCheck({ formation: formation(), actor: members.a1, key: "thing:thing-2", layer: "hasty" })).reason, SESSION_REFUSAL.NOT_ALLOWED, "a player's client resolves nothing");
  user.isGM = true;

  // a body's pockets turn out on a hasty check; its state is in the session
  await S.writeSession(formation(), { ...S.readSession(formation()), bodies: [{ id: "c1", ref: "Actor.ogre", hidden: false, hint: null, point: null, state: {}, layers: {} }], lots: [...S.readSession(formation()).lots, { key: "body:c1/1", thing: "body:c1", layer: "hasty", cardId: "x" }] });
  const body = await A.resolveSceneCheck({ formation: formation(), actor: members.a2, key: "body:c1", layer: "hasty" });
  eq([body.outcome.code, body.outcome.lots, S.readSession(formation()).bodies[0].state.layers.hasty.found], [CODE.FOUND, ["body:c1/1"], true], "a hasty check of a body turns out its pockets, and the body's state is kept in the session");
  eq(body.lots.missing, ["body:c1/1"], "a body's lot with no card is reported missing, not lost");
}

/* ---------------- the Round press's seam ---------------- */
{
  await party.update({ [`flags.${MODULE_ID}.turnPlan`]: ForcedReplacement.create({
    a1: { key: ACTIVITY.HASTY, option: "thing:thing-6", remaining: 1, turns: 1 },
    a2: { key: ACTIVITY.METHODICAL, option: "thing:thing-1", remaining: 1, turns: 1 },
    a3: { key: ACTIVITY.HASTY, option: "thing:thing-1", remaining: 1, turns: 1, resolvedTurn: 3 },
  }) });
  const plan = () => party.getFlag(MODULE_ID, "turnPlan");
  const due = dueRoundEntries(plan());
  eq(due.map((d) => d.actorId), ["a1"], "only an unresolved round-length scene entry is due at a Round press");

  const calls = [];
  const viaPlan = await resolveSceneRound(formation(), {
    plan: { resolvePlanRound: async (f) => (calls.push(f.id), { results: [{ status: "resolved" }] }), readPlan: () => assert.fail("not read"), unlockPlan: () => assert.fail("not written") },
    actorOf: () => assert.fail("no actor lookup"),
    readSession: () => assert.fail("no session read"),
  });
  eq([viaPlan.via, calls, viaPlan.results.length], ["plan", ["f1"], 1], "with close-out's resolver present the press calls it and does nothing else");

  const unlocked = [];
  const own = await resolveSceneRound(formation(), {
    plan: { readPlan: () => plan(), unlockPlan: async (f, id) => { unlocked.push(id); const next = { ...plan() }; delete next[id]; await party.update({ [`flags.${MODULE_ID}.turnPlan`]: ForcedReplacement.create(next) }); } },
    actorOf: (_f, id) => members[id],
    readSession: S.readSession,
  });
  eq([own.via, unlocked, own.results.map((r) => r.status)], ["scene", ["a1"], ["resolved"]], "without it the scene resolves its own round entries through the activity's resolve");
  eq(Object.keys(plan()).sort(), ["a2", "a3"], "and takes them out of the plan so the next Turn does not roll them again");
  eq(own.results[0].result.reason, REFUSAL.OUT_OF_REACH, "the entry ran the activity's own resolve (this one was refused for reach)");
  eq((await resolveSceneRound(formation(), { plan: { readPlan: () => plan(), unlockPlan: async () => assert.fail("none due") }, actorOf: () => null, readSession: () => null })).results, [], "a party with no session resolves nothing here");
}

/* ---------------- the session api ---------------- */
{
  const lockCalls = [];
  const relayed = [];
  const plan = {
    lockPlan: async (_f, req) => (lockCalls.push(req), { ok: true, entry: { key: req.key } }),
    unlockPlan: async () => true,
    planRefusal: (_f, req) => (req.actorId === "a3" ? { reason: REFUSAL.TOOL_MISSING, missing: ["x"] } : null),
    readPlan: () => party.getFlag(MODULE_ID, "turnPlan") ?? {},
  };
  const api = createSceneSearchApi({ plan, request: async (id, type, payload) => (relayed.push([id, type, payload]), { ok: true }) });
  eq((await api.assign({ partyId: "f1", actorId: "a1", layer: "hasty", entryKey: "thing:thing-1" })).ok, true, "a Judge assigns by locking the plan");
  eq([lockCalls[0].key, lockCalls[0].option, lockCalls[0].by], [ACTIVITY.HASTY, "thing:thing-1", "j1"], "the lock names the activity, the entry and who");
  eq((await api.assign({ partyId: "f1", actorId: "a1", layer: "hasty", entryKey: "thing:nope" })).reason, SESSION_REFUSAL.UNKNOWN_ENTRY, "an unknown entry is refused");
  eq((await api.assign({ partyId: "f1", actorId: "zz", layer: "hasty", entryKey: "thing:thing-1" })).reason, SESSION_REFUSAL.NOT_A_MEMBER, "a stranger is refused");
  eq((await api.assign({ partyId: "f1", actorId: "a1", layer: "bogus", entryKey: "thing:thing-1" })).reason, SESSION_REFUSAL.NOT_OFFERED, "a layer that is not one is refused");
  user.isGM = false;
  eq((await api.assign({ partyId: "f1", actorId: "a2", layer: "methodical", entryKey: "thing:thing-1" })).ok, true, "a player's assignment goes through the party's plan relay");
  eq(relayed[0], ["f1", "plan", { actorId: "a2", key: ACTIVITY.METHODICAL, option: "thing:thing-1" }], "as that request");
  eq((await api.assign({ partyId: "f1", actorId: "a3", layer: "methodical", entryKey: "thing:thing-1" })).reason, REFUSAL.TOOL_MISSING, "and is refused on the player's own client with the reason");
  eq(relayed.length, 1, "without being relayed");
  eq([(await api.open({ partyId: "f1", placeUuid: place.uuid })).reason, (await api.end("f1")).reason], [SESSION_REFUSAL.NOT_ALLOWED, SESSION_REFUSAL.NOT_ALLOWED], "a player opens and ends nothing");
  const seen = api.read("f1");
  ok(seen.entries.every((e) => ["hasty", "methodical"].every((n) => SL.layerState(e, n).found || e.layers[n].yields.lots.length === 0)), "a player's read carries no unfound lot key");
  ok(seen.entries.some((e) => e.layers.hasty.yields.lots.length > 0), "while a found layer keeps its lot");
  eq([seen.session.lots, seen.session.bodies], [undefined, undefined], "nor the session's lot map or bodies");
  user.isGM = true;
  ok(api.read("f1").session.lots.length > 0, "the Judge's read carries the lot map");

  eq((await api.open({ partyId: "f1", placeUuid: place.uuid })).reason, SESSION_REFUSAL.SESSION_OPEN, "a second session is refused while one is open");
  eq((await api.open({ partyId: "zz", placeUuid: place.uuid })).reason, SESSION_REFUSAL.NO_PARTY, "an unknown party is refused");
  eq((await api.end("f1")).ok, true, "the Judge ends the session");
  eq([S.readSession(formation()), api.read("f1")], [null, null], "and nothing is left on the party");
  eq((await api.open({ partyId: "f1", placeUuid: "Actor.nowhere" })).reason, SESSION_REFUSAL.NO_PLACE, "a place that is not there is refused");
  eq((await api.open({ partyId: "f1", placeUuid: place.uuid, sources: [{ thing: "thing:nope", truths: [truth("x")] }] })).reason, SESSION_REFUSAL.UNKNOWN_ENTRY, "a source naming an entry the scene lacks is refused before anything is dealt");
  const potsBefore = piles.length;
  const bare = await api.open({ partyId: "f1", placeUuid: place.uuid, sceneId: "s1" });
  eq([bare.ok, bare.potUuid, piles.length], [true, null, potsBefore], "a session with nothing to deal makes no pot");
  await api.end("f1");

  messages.set("m1", { flags: { [MODULE_ID]: { treasureSearch: { combatId: "k", fallen: [{ combatantId: "c1", name: "Ogre", actorUuid: "Actor.ogre", goods: [{ itemId: "i1", truths: [truth("Ladle")] }] }] } } } });
  const fight = await api.open({ partyId: "f1", placeUuid: place.uuid, sceneId: "s1", recordMessageId: "m1", metInLair: true });
  eq([fight.ok, fight.session.bodies.map((b) => b.id), fight.session.lots.map((l) => l.thing), fight.session.recordMessageId], [true, ["c1"], ["body:c1"], "m1"], "a fight's record becomes the session's bodies and its goods a lot behind each body");
  const entries = api.read("f1").entries;
  ok(entries.some((e) => e.key === "body:c1"), "and the body is an entry");
  eq((await api.assignments("f1")).length, 2, "the plan's scene entries are readable");
  const rowsOf = api.options({ partyId: "f1", actorId: "a1" });
  eq(rowsOf.length, entries.length, "a screen reads what a member may attempt at each entry");
  await addThingTo(place, base("", THING_KINDS.FLOOR));
  const floor = api.options({ partyId: "f1", actorId: "a1" }).find((r) => r.key === "thing:thing-8").layers[0];
  eq([floor.mode, floor.target, floor.bonus], ["search", 14, null], "the thief's bonus is already in the member's target, so none is added on top");
  await api.end("f1");
}

console.log(`test-scene-session: ${checks} checks passed`);
