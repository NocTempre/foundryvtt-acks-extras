/**
 * The round advance's guard (scripts/lib/patches/combat-round.mjs).
 *
 * A stand-in for the system's combat: a `nextRound` that reads every row's
 * actor in its synchronous prefix, as the system's does, then records which
 * seat ran it and moves the round on after an await. What this pins is the
 * dispatch — a player's advance runs core's method once, on the GM's seat,
 * and never on the player's — the GM handler's refusals (a stale round or
 * turn, an advance already in flight, a player whose combatant is not up, no
 * GM connected), and the actor-less stand-in on the GM's seat. That the two
 * seats' trackers then agree is the live recipe's to prove
 * (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const GM = { id: "gm", isGM: true };
const PLAYER = { id: "player", isGM: false };
const OTHER = { id: "other", isGM: false };
const USERS = [GM, PLAYER, OTHER];

/** Every run of the stand-in core method: the seat it ran on and the combat. */
const coreRuns = [];
const warnings = [];
/** What was registered for a one-time hook, so the test can fire `socketlib.ready` itself. */
const onceHooks = new Map();
/** The handler names a player's seat sent to the GM, and their payloads. */
const relayed = [];

/** A combatant whose `actor` is a class getter, as core's is, so a shadow can be deleted off it. */
class Combatant {
  constructor(id, actor, players = []) {
    this.id = id;
    this._actor = actor;
    this.players = players;
  }

  get actor() {
    return this._actor;
  }
}

/** An actor with no effects. */
const actor = () => ({ hasEffect: () => false, statuses: new Set() });

class Combat {
  constructor({ id, round = 1, turn = 0, turns = [] }) {
    Object.assign(this, { id, round, turn, turns });
  }

  get combatant() {
    return this.turns[this.turn] ?? null;
  }

  async nextRound() {
    for (const t of this.turns) t.actor.hasEffect("delayed");
    coreRuns.push({ seat: game.user.id, combat: this.id });
    await new Promise((r) => setTimeout(r, 5));
    this.round += 1;
    this.turn = 0;
    return this;
  }
}

const combats = new Map();
globalThis.Hooks = { on() {}, once: (name, fn) => onceHooks.set(name, [...(onceHooks.get(name) ?? []), fn]), call() {}, callAll() {} };
globalThis.ui = { notifications: { warn: (text) => warnings.push(text), info() {}, error() {} } };
globalThis.CONFIG = { Combat: { documentClass: Combat } };
globalThis.game = {
  user: GM,
  users: { get: (id) => USERS.find((u) => u.id === id) ?? null, activeGM: GM },
  combats,
  i18n: { localize: (key) => key },
};

const { installCombatRoundPatch, roundRefusal, NEXT_ROUND_HANDLER } = await import("../scripts/lib/patches/combat-round.mjs");
installCombatRoundPatch();

// socketlib as it runs a request: on the GM's seat, with the sender attested.
const handlers = new Map();
globalThis.socketlib = {
  registerModule: () => ({
    register: (name, fn) => handlers.set(name, fn),
    executeAsGM: async (name, payload) => {
      const seat = game.user;
      relayed.push({ name, payload: structuredClone(payload) });
      game.user = GM;
      try {
        return await handlers.get(name).call({ socketdata: { userId: seat.id } }, structuredClone(payload));
      } finally {
        game.user = seat;
      }
    },
  }),
};
for (const fn of onceHooks.get("socketlib.ready") ?? []) fn();

/** A combat of three rows, the last owned by `owner`, standing on that row in round 1. */
function fight(id, { owner = PLAYER, round = 1 } = {}) {
  const combat = new Combat({
    id,
    round,
    turns: [new Combatant("ally", actor()), new Combatant("foe", actor()), new Combatant("pc", actor(), [owner])],
  });
  combat.turn = 2;
  combats.set(id, combat);
  return combat;
}

/** Run `fn` from the player's seat, then return to the GM's; the record of every earlier call is cleared first. */
async function asPlayer(fn) {
  coreRuns.length = 0;
  warnings.length = 0;
  relayed.length = 0;
  game.user = PLAYER;
  try {
    return await fn();
  } finally {
    game.user = GM;
  }
}

await test("a GM's advance runs core's method on the GM's seat and relays nothing", async () => {
  const combat = fight("c-gm");
  coreRuns.length = 0;
  relayed.length = 0;
  assert.equal(await combat.nextRound(), combat);
  assert.deepEqual(coreRuns, [{ seat: "gm", combat: "c-gm" }]);
  assert.deepEqual([combat.round, relayed.length], [2, 0]);
});

await test("a player's advance runs core's method once, on the GM's seat, and never on the player's", async () => {
  const combat = fight("c-player");
  const result = await asPlayer(() => combat.nextRound());
  assert.equal(result, combat, "the player's call resolves to the combat, as core's does");
  assert.deepEqual(relayed, [{ name: NEXT_ROUND_HANDLER, payload: { combatId: "c-player", round: 1, turn: 2 } }]);
  assert.deepEqual(coreRuns, [{ seat: "gm", combat: "c-player" }]);
  assert.deepEqual([combat.round, combat.turn, warnings], [2, 0, []]);
});

await test("a request on a round or turn the combat has left is refused as stale", async () => {
  const combat = fight("c-stale");
  const send = (payload) => socketlib.registerModule().executeAsGM(NEXT_ROUND_HANDLER, payload);
  const answers = await asPlayer(async () => [
    await send({ combatId: "c-stale", round: 0, turn: 2 }),
    await send({ combatId: "c-stale", round: 1, turn: 1 }),
  ]);
  assert.deepEqual(answers, [{ error: "stale" }, { error: "stale" }]);
  assert.deepEqual([coreRuns, combat.round], [[], 1]);
});

await test("a press made twice before the first advance resolves advances once", async () => {
  const combat = fight("c-double");
  coreRuns.length = 0;
  // Both requests as the GM's seat receives them, the second while the first is in flight.
  const relay = handlers.get(NEXT_ROUND_HANDLER);
  const payload = { combatId: "c-double", round: 1, turn: 2 };
  const sent = { socketdata: { userId: PLAYER.id } };
  const answers = await Promise.all([relay.call(sent, payload), relay.call(sent, payload)]);
  assert.deepEqual(answers, [{ ok: true, round: 2, turn: 0 }, { error: "stale" }]);
  assert.deepEqual(coreRuns, [{ seat: "gm", combat: "c-double" }]);
});

await test("a player whose combatant is not up is refused, and told why", async () => {
  const combat = fight("c-foreign", { owner: OTHER });
  await asPlayer(() => combat.nextRound());
  assert.deepEqual([coreRuns, combat.round], [[], 1]);
  assert.deepEqual(warnings, ["ACKS-LIB.combatRound.notYourTurn"]);
});

await test("with no GM connected nothing advances, and the seat is told a GM is needed", async () => {
  const combat = fight("c-alone");
  game.users.activeGM = null;
  try {
    await asPlayer(() => combat.nextRound());
  } finally {
    game.users.activeGM = GM;
  }
  assert.deepEqual([coreRuns, relayed, combat.round], [[], [], 1]);
  assert.deepEqual(warnings, ["ACKS-LIB.socket.noGm"]);
});

await test("on the GM's seat an actor-less combatant is stood in for while core reads, and released after", async () => {
  const combat = fight("c-orphan");
  const orphan = new Combatant("gone", null);
  combat.turns.splice(1, 0, orphan);
  combat.turn = 3;
  const warn = console.warn;
  console.warn = () => {};
  try {
    coreRuns.length = 0;
    await combat.nextRound();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual([coreRuns.length, combat.round], [1, 2]);
  assert.equal(orphan.actor, null);
  assert.equal(Object.prototype.hasOwnProperty.call(orphan, "actor"), false);
});

await test("the refusal reads the request alone: no combat, and the Judge's own request is not turn-checked", async () => {
  const combat = fight("c-judge", { owner: OTHER });
  assert.equal(roundRefusal(null, { round: 1, turn: 2 }, "player"), "noCombat");
  assert.equal(roundRefusal(combat, { round: 1, turn: 2 }, null), null);
  assert.equal(roundRefusal(combat, { round: 1, turn: 2 }, "other"), null);
  assert.equal(roundRefusal(combat, { round: 1, turn: 2 }, "player"), "notYourTurn");
});

console.log(`\n${passed} passed`);
