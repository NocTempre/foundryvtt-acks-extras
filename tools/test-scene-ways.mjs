/**
 * The ways into a scene search: which party a fight's record belongs to, what a
 * press of Search the scene or Search here does (open, show the screen, wait,
 * refuse), and the call over a fake world: the place the party stands in, the
 * card stamped once its scene opens with what the opening made, a Judge's press
 * on a spent card reopening it, and what a Judge is told. Every name here
 * is this file's own invention.
 */
import assert from "node:assert/strict";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};

const notes = [];
globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k, has: () => true }, settings: { get: () => ({}) } };
globalThis.ui = { notifications: { warn: (text) => notes.push(text) } };

const { WAYS_REFUSAL, SESSION_REFUSAL } = await import("../scripts/scene-search/constants.mjs");
const { partyOfRecord, planPress } = await import("../scripts/scene-search/ways-in-logic.mjs");
const { createWaysIn } = await import("../scripts/scene-search/ways-in.mjs");

/* --- which party a fight's record is about --- */
{
  const parties = [{ id: "f1", sceneId: "s1" }, { id: "f2", sceneId: "s2" }];
  eq(partyOfRecord(parties, { sceneId: "s2" }), "f2", "the one party whose token is on the fight's scene");
  eq(partyOfRecord([{ id: "f1", sceneId: "s1" }], { sceneId: "elsewhere" }), "f1", "else the only party the world has");
  eq(partyOfRecord(parties, { sceneId: "elsewhere" }), null, "with two parties and none on the scene, none is named");
  eq(partyOfRecord([{ id: "f1", sceneId: "s1" }, { id: "f2", sceneId: "s1" }], { sceneId: "s1" }), null, "two parties on the scene are not told apart, even though the world has only these");
  eq(partyOfRecord(parties, { sceneId: null }), null, "a record with no scene names none among several");
  eq(partyOfRecord([{ id: "f1" }], null), "f1", "a world with one party names it for a record with no scene");
  eq([partyOfRecord([], { sceneId: "s1" }), partyOfRecord(null, null), partyOfRecord([{ sceneId: "s1" }], { sceneId: "s1" })], [null, null, null], "no party, or one with no id, is none");
}

/* --- what a press does --- */
{
  eq(planPress({ partyId: null, hasSession: false, busy: false }), { action: "refuse", reason: WAYS_REFUSAL.NO_PARTY_HERE }, "no party is refused");
  eq(planPress({ partyId: "f1", hasSession: true, busy: false }), { action: "screen" }, "a session already open opens its screen");
  eq(planPress({ partyId: "f1", hasSession: true, busy: true, record: { opened: true } }), { action: "screen" }, "and that is so whatever the card says");
  eq(planPress({ partyId: "f1", hasSession: false, busy: true }), { action: "wait" }, "a second press while the first opens one does nothing");
  eq(planPress({ partyId: "f1", hasSession: false, busy: false, record: { opened: true } }), { action: "refuse", reason: WAYS_REFUSAL.CARD_SPENT }, "a card whose scene was opened and has ended is refused, for a press that does not say it is a Judge's");
  eq(planPress({ partyId: "f1", hasSession: false, busy: false, record: { opened: true }, isGM: false }), { action: "refuse", reason: WAYS_REFUSAL.CARD_SPENT }, "and for a player");
  eq(planPress({ partyId: "f1", hasSession: false, busy: false, record: { opened: true }, isGM: true }), { action: "reopen" }, "a Judge's press reopens it");
  eq(planPress({ partyId: "f1", hasSession: true, busy: false, record: { opened: true }, isGM: true }), { action: "screen" }, "or opens the screen where a session is open");
  eq(planPress({ partyId: "f1", hasSession: false, busy: true, record: { opened: true }, isGM: true }), { action: "wait" }, "or waits while one is opening");
  eq(planPress({ partyId: "f1", hasSession: false, busy: false, record: { opened: false }, isGM: true }), { action: "open" }, "and a fresh card still opens one for a Judge");
  eq(planPress({ partyId: null, hasSession: false, busy: false, record: { opened: true }, isGM: true }), { action: "refuse", reason: WAYS_REFUSAL.NO_PARTY_HERE }, "a party no one could name is still refused");
  eq(planPress({ partyId: "f1", hasSession: false, busy: false, record: { opened: false } }), { action: "open" }, "a fresh card opens one");
  eq(planPress({ partyId: "f1", hasSession: false, busy: false }), { action: "open" }, "and so does the tab, which has no card");
}

/* --- the call, over a fake world --- */
const world = () => {
  const log = { opened: [], screens: [], stamped: [], made: [], warned: [] };
  const state = {
    isGM: true,
    sessions: new Set(),
    token: { parent: { id: "s1" } },
    places: [{ place: { uuid: "Actor.close" } }, { place: { uuid: "Actor.wide" } }],
    records: { m1: { combatId: "k", sceneId: "s1", fallen: [{ combatantId: "c1", name: "Ogre" }] } },
    answer: { ok: true, potUuid: "Cards.pot", session: { lots: [{ key: "body:c1/1", thing: "body:c1", layer: "hasty", cardId: "x1" }] } },
  };
  const deps = {
    isGM: () => state.isGM,
    parties: () => [{ id: "f1", sceneId: "s1" }],
    formationOf: (id) => (id === "f1" ? { id } : null),
    hasSession: (f) => state.sessions.has(f.id),
    tokenOf: () => state.token,
    around: () => state.places,
    record: (id) => state.records[id] ?? null,
    open: async (args) => (log.opened.push(args), typeof state.answer === "function" ? state.answer(args) : await state.answer),
    openScreen: (id) => log.screens.push(id),
    stamp: async (id, made) => (log.stamped.push(id), log.made.push(made)),
    confirmLair: () => true,
    potGoneText: () => "pot gone",
    reasonText: (reason) => `said:${reason}`,
    warn: (text) => log.warned.push(text),
  };
  return { log, state, search: createWaysIn(deps) };
};
{
  const { log, state, search } = world();
  const fight = await search({ recordMessageId: "m1" });
  eq(fight, { ok: true, opened: true, potUuid: "Cards.pot" }, "a card opens the scene search");
  eq(log.made, [{ potUuid: "Cards.pot", placeUuid: "Actor.close", lots: [{ key: "body:c1/1", thing: "body:c1", layer: "hasty", cardId: "x1" }] }], "and the card keeps the pot, the place and the lots the opening made");
  eq(log.opened.map(({ confirmLair, ...rest }) => rest), [{ partyId: "f1", placeUuid: "Actor.close", sceneId: "s1", recordMessageId: "m1" }], "for the party on the fight's scene, at the closest place the party's token stands in, with the card's record");
  eq([log.opened[0].confirmLair(), log.screens, log.stamped], [true, ["f1"], ["m1"]], "the lair warning is answered, the screen opens and the card is stamped");

  const tab = await search({ partyId: "f1" });
  eq([tab.ok, log.opened.at(-1).recordMessageId, log.stamped.length], [true, null, 1], "the tab opens one with no record and stamps no card");

  state.sessions.add("f1");
  const before = log.opened.length;
  eq(await search({ partyId: "f1" }), { ok: true, opened: false }, "an open session opens its screen");
  eq([log.opened.length, log.screens.length], [before, 3], "and deals nothing");
  state.sessions.delete("f1");

  state.isGM = false;
  eq([(await search({ partyId: "f1" })).reason, log.opened.length], [SESSION_REFUSAL.NOT_ALLOWED, before], "a player opens nothing");
  state.isGM = true;
}
{
  const { log, state, search } = world();
  state.records.m1.opened = true;
  state.records.m1.potUuid = "Cards.kept";
  state.records.m1.placeUuid = "Actor.first";
  state.answer = { ok: true, potUuid: "Cards.kept", reopened: true, potGone: false };
  const again = await search({ recordMessageId: "m1" });
  eq(again, { ok: true, opened: true, reopened: true, potUuid: "Cards.kept" }, "a Judge's press on a card whose scene has ended reopens it");
  eq(log.opened.map(({ confirmLair, ...rest }) => rest), [{ partyId: "f1", placeUuid: "Actor.first", sceneId: "s1", recordMessageId: "m1" }], "at the place the first opening used, not where the party stands now, with no deal asked for");
  eq([log.stamped, log.screens, log.warned], [[], ["f1"], []], "the card is not stamped again, the screen opens and nothing is said");

  state.answer = { ok: true, potUuid: null, reopened: true, potGone: true };
  const noPot = await search({ recordMessageId: "m1" });
  eq([noPot.ok, noPot.potUuid, log.warned, log.opened.length, log.stamped], [true, null, ["pot gone"], 2, []], "a pot that is gone still reopens the scene, the Judge is told, nothing is dealt and the card keeps its stamp");

  state.answer = { ok: false, reason: SESSION_REFUSAL.NO_PLACE };
  eq([(await search({ recordMessageId: "m1" })).reason, log.opened.length, log.opened.at(-1).sources], [SESSION_REFUSAL.NO_PLACE, 3, undefined], "a place that is gone is refused with the api's words, and a reopen never retries a deal");
  state.answer = { ok: false, reason: SESSION_REFUSAL.DEAL_FAILED, detail: "empty" };
  const refusedEmpty = await search({ recordMessageId: "m1" });
  eq([refusedEmpty.ok, log.opened.length], [false, 4], "nor does a reopen answered empty ask for a second deal");

  delete state.records.m1.placeUuid;
  state.answer = { ok: true, potUuid: null, reopened: true, potGone: false };
  await search({ recordMessageId: "m1" });
  eq(log.opened.at(-1).placeUuid, "Actor.close", "a card stamped with no place reopens where the party stands");
  state.token = null;
  eq((await search({ recordMessageId: "m1" })).reason, WAYS_REFUSAL.NO_PLACE_HERE, "and with no place at all is refused");
  state.token = { parent: { id: "s1" } };
  state.records.m1.placeUuid = "Actor.first";
  state.token = null;
  const noToken = await search({ recordMessageId: "m1" });
  eq([noToken.ok, log.opened.at(-1).placeUuid, log.opened.at(-1).sceneId], [true, "Actor.first", "s1"], "a reopened scene with no token on the map keeps the card's place and scene");
  state.token = { parent: { id: "s2" } };
  const moved = await search({ recordMessageId: "m1" });
  eq([moved.ok, log.opened.at(-1).placeUuid, log.opened.at(-1).sceneId], [true, "Actor.first", "s1"], "a party that has moved to another scene reopens the fight's place on the fight's scene");
  state.token = { parent: { id: "s1" } };

  state.isGM = false;
  const opens = log.opened.length;
  eq([(await search({ recordMessageId: "m1" })).reason, log.opened.length], [SESSION_REFUSAL.NOT_ALLOWED, opens], "a player's press on a spent card reopens nothing");
  state.isGM = true;
}
{
  const { log, state, search } = world();
  state.token = null;
  eq((await search({ partyId: "f1" })).reason, WAYS_REFUSAL.NO_PLACE_HERE, "a party with no token stands in no place");
  state.token = { parent: { id: "s1" } };
  state.places = [];
  eq((await search({ partyId: "f1" })).reason, WAYS_REFUSAL.NO_PLACE_HERE, "a party whose token no place holds is refused");
  eq([log.opened.length, log.warned.length], [0, 2], "and nothing is dealt");

  eq((await search({ partyId: "zz" })).reason, WAYS_REFUSAL.NO_PARTY_HERE, "an unknown party is refused");
  state.places = [{ place: { uuid: "Actor.close" } }];
  eq([(await search({ recordMessageId: "gone" })).ok, log.opened.at(-1).recordMessageId], [true, "gone"], "a card whose record is gone still finds the only party the world has");
}
{
  const { log, state, search } = world();
  state.places = [{ place: { uuid: "Actor.close" } }];
  state.answer = { ok: false, reason: SESSION_REFUSAL.DEAL_FAILED, detail: "lairDeclined" };
  const declined = await search({ recordMessageId: "m1" });
  eq([declined.ok, declined.detail, log.warned.length, log.stamped.length, log.screens.length], [false, "lairDeclined", 0, 0, 0], "a deal the Judge declined says nothing, stamps no card and opens no screen");
  state.answer = { ok: false, reason: SESSION_REFUSAL.DEAL_FAILED, detail: "failed" };
  eq([(await search({ recordMessageId: "m1" })).ok, log.warned.length, log.stamped.length], [false, 1, 0], "a deal that failed is told, and the card stays fresh");

  // A deal that rolled nothing opens the scene with its bodies and no pot, so a second press cannot roll again.
  state.answer = (args) => (Array.isArray(args.sources) ? { ok: true, potUuid: null } : { ok: false, reason: SESSION_REFUSAL.DEAL_FAILED, detail: "empty" });
  const before = log.opened.length;
  const bodiesOnly = await search({ recordMessageId: "m1" });
  eq([bodiesOnly.ok, bodiesOnly.potUuid, log.opened.length - before, log.opened.at(-1).sources, log.warned.length, log.stamped, log.screens.length], [true, null, 2, [], 1, ["m1"], 1], "a deal that rolled nothing opens the scene with the bodies only, once, and stamps the card");

}
{
  // A second press while the first is still dealing waits, and the card is stamped once.
  const { log, state, search } = world();
  let release;
  state.answer = new Promise((resolve) => (release = resolve));
  const first = search({ recordMessageId: "m1" });
  const second = await search({ recordMessageId: "m1" });
  eq([second.ok, second.reason, log.opened.length], [false, SESSION_REFUSAL.SESSION_OPEN, 1], "a press while the first is dealing deals nothing more");
  release({ ok: true, potUuid: null });
  eq([(await first).ok, log.stamped], [true, ["m1"]], "and the first finishes and stamps the card once");
  state.answer = { ok: true, potUuid: null };
  eq((await search({ recordMessageId: "m1" })).ok, true, "once it is done the party can be searched for again");
}

console.log(`test-scene-ways: ${checks} checks passed`);
