/**
 * What Automated Animations is told about an attack card
 * (scripts/lib/animations.mjs).
 *
 * Stand-in libWrapper, chat speaker and dice: the attack is held in flight by
 * the seam's own wrapper, as it is when the real card lands, and the listener
 * writes onto a plain object shaped like Automated Animations' gathered data.
 * That the module reads those fields, and what it draws from them, is the live
 * recipe's to prove (docs/lib/TESTING.md).
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const noop = function () {};
let wrapper = null;
let speakerActor = null;
globalThis.game = { system: { id: "acks" }, user: { targets: new Set() } };
globalThis.libWrapper = { register: (_id, path, fn) => { if (path.endsWith("makeAttackThrow")) wrapper = fn; } };
globalThis.CONFIG = {
  Actor: { documentClass: { prototype: { makeAttackThrow: noop } }, dataModels: {} },
  Item: { dataModels: { weapon: { prototype: { getAttackTypes: noop, getDamageModes: noop, getDamageFormula: noop } } } },
};
globalThis.Hooks = { callAll: noop, on: noop };
globalThis.ChatMessage = { getSpeakerActor: () => speakerActor };

const { installAttackThrowPatch } = await import("../scripts/lib/patches/attack-throw.mjs");
const { annotateForAnimation } = await import("../scripts/lib/animations.mjs");
const { ACTOR_TYPE } = await import("../scripts/lib/vocab.mjs");
installAttackThrowPatch();

const card = (outcome) => `<div class="attack-throw-card__outcome attack-throw-card__outcome--${outcome}"></div>`;
const message = (outcome, extra = {}) => ({ id: "msg1", speaker: { actor: "a" }, content: card(outcome), whisper: [], blind: false, ...extra });
const placed = { id: "target-token" };

/** Run the listener with an attack in flight, its type read as the throw's builder would. */
async function during({ actor = { type: ACTOR_TYPE.character }, type = "melee", target = placed, spoken = actor } = {}, data) {
  speakerActor = spoken;
  game.actors = { get: () => actor };
  game.user.targets = new Set(target ? [{ document: { object: target } }] : []);
  await wrapper.call(actor, async () => {
    const { attackInFlight } = await import("../scripts/lib/patches/attack-throw.mjs");
    attackInFlight(actor).type = type;
    annotateForAnimation(data);
    return null;
  }, {});
  return data;
}

await ok("a hit names the target as hit", async () => {
  const data = await during({}, { workflow: message("hit"), targets: [], extraNames: [] });
  assert.deepEqual(data.targets, [placed]);
  assert.equal(data.playOnMiss, true);
  assert.deepEqual(data.hitTargets, [placed]);
});

await ok("a miss names the target but no hit", async () => {
  const data = await during({}, { workflow: message("miss"), targets: [], extraNames: [] });
  assert.deepEqual(data.targets, [placed]);
  assert.equal(data.playOnMiss, true);
  assert.deepEqual(data.hitTargets, []);
});

await ok("every outcome on the card reads the right way", async () => {
  for (const [outcome, hit] of [["critical", true], ["auto-hit", true], ["hit", true], ["auto-miss", false], ["miss", false]]) {
    const data = await during({}, { workflow: message(outcome), targets: [], extraNames: [] });
    assert.deepEqual(data.hitTargets, hit ? [placed] : [], outcome);
  }
});

await ok("the target is the throw's, whatever is targeted when the card lands", async () => {
  const data = { workflow: message("hit"), targets: [{ id: "someone-else" }], extraNames: [] };
  await during({}, data);
  assert.deepEqual(data.targets, [placed]);
});

await ok("an attack at nothing has no target and no hit", async () => {
  const data = await during({ target: null }, { workflow: message("hit"), targets: [], extraNames: [] });
  assert.deepEqual(data.targets, []);
  assert.deepEqual(data.hitTargets, []);
});

await ok("a whispered or blind attack keeps its result", async () => {
  for (const extra of [{ whisper: ["gm"] }, { blind: true }]) {
    const data = await during({}, { workflow: message("miss", extra), targets: [], extraNames: [] });
    assert.deepEqual(data.targets, [placed]);
    assert.equal(data.playOnMiss, undefined);
    assert.equal(data.hitTargets, undefined);
  }
});

await ok("the fallback row follows the kind of attack and who makes it", async () => {
  const character = { type: ACTOR_TYPE.character };
  const creature = { type: ACTOR_TYPE.monster };
  const row = async (actor, type) => (await during({ actor, type }, { workflow: message("hit"), targets: [], extraNames: [] })).extraNames;
  assert.deepEqual(await row(character, "melee"), ["Sword"]);
  assert.deepEqual(await row(creature, "melee"), ["Unarmed Strike"]);
  assert.deepEqual(await row(character, "missile"), ["Bow"]);
  assert.deepEqual(await row(creature, "missile"), ["Bow"]);
  assert.deepEqual(await row(character, "thrown"), ["Dagger"]);
  assert.deepEqual(await row(character, null), ["Sword"]);
});

await ok("the wait for the dice is the message's own, and only with the dice", async () => {
  const data = await during({}, { workflow: message("hit"), targets: [], extraNames: [] });
  assert.equal(data.deferrals, undefined);
  const waits = [];
  game.dice3d = { waitFor3DAnimationByMessageID: (id) => { waits.push(id); return Promise.resolve(true); } };
  const held = await during({}, { workflow: message("hit"), targets: [], extraNames: [] });
  delete game.dice3d;
  assert.deepEqual(waits, ["msg1"]);
  assert.equal(held.deferrals.length, 1);
});

await ok("a world actor's attack reads through a card naming its unlinked token", async () => {
  const data = await during({ spoken: { type: ACTOR_TYPE.monster } }, { workflow: message("miss"), targets: [], extraNames: [] });
  assert.deepEqual(data.hitTargets, []);
  assert.equal(data.playOnMiss, true);
});

await ok("a card with no attack in flight is left as it reads", async () => {
  speakerActor = { type: ACTOR_TYPE.character };
  game.actors = { get: () => null };
  const data = { workflow: message("hit"), targets: ["kept"], extraNames: [] };
  annotateForAnimation(data);
  assert.deepEqual(data, { workflow: data.workflow, targets: ["kept"], extraNames: [] });
});

await ok("a card that names no outcome is left as it reads, attack or none", async () => {
  const data = await during({}, { workflow: message("hit", { content: "<div>a notice</div>" }), targets: ["kept"], extraNames: [] });
  assert.deepEqual(data.targets, ["kept"]);
  assert.deepEqual(data.extraNames, []);
  assert.equal(data.playOnMiss, undefined);
});

await ok("a hidden token's card stops the workflow, attack or not", async () => {
  const placeable = { document: { hidden: true } };
  const spell = { workflow: { speaker: { actor: "a" }, content: "<div>a spell</div>" }, token: placeable };
  annotateForAnimation(spell);
  assert.equal(spell.stopWorkflow, true);
  const attack = await during({}, { workflow: message("hit"), token: { hidden: true }, targets: [], extraNames: [] });
  assert.equal(attack.stopWorkflow, true);
  assert.equal(attack.playOnMiss, undefined);
});

await ok("no message, no write: the public API reaches the listener with none", async () => {
  const data = { token: { hidden: true } };
  annotateForAnimation(data);
  assert.deepEqual(data, { token: { hidden: true } });
  annotateForAnimation(null);
});

console.log(`\n${passed} passed`);
