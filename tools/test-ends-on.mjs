/**
 * A record that ends when its bearer is hurt or attacks (`lib/ends-on.mjs`, and
 * the loss hooks of `lib/status-effects.mjs`).
 *
 * The pure half is checked on its own: which causes a flag names and which
 * effect ids a cause ends. The tracker's half runs the installed hooks over
 * mock actors: damage and an attack each delete only the records whose flag
 * names them, by id; a hit point loss that does not lower them, another
 * client's update and an actor with nothing to lose do nothing; the slumbering
 * state is lost to damage and to a move; and a record and a state that damage
 * costs together are taken in order, once each.
 */
import assert from "node:assert/strict";
import { MODULE_ID, FLAG_ENDS_ON } from "../scripts/lib/constants.mjs";
import { ENDS_ON_CAUSES, readEndsOn, endedBy } from "../scripts/lib/ends-on.mjs";
import { CONDITIONS, lostTo } from "../scripts/lib/conditions.mjs";
import { POST_ATTACK_HOOK } from "../scripts/lib/patches/attack-throw.mjs";

let passed = 0;
const ok = (message) => {
  passed++;
  console.log(`ok   ${message}`);
};

/** An effect stand-in carrying an `endsOn` flag, or none. */
const effect = (id, causes) => ({ id, name: `record ${id}`, flags: causes === undefined ? {} : { [MODULE_ID]: { [FLAG_ENDS_ON]: causes } } });

/* --- the pure half ------------------------------------------------------------- */

{
  assert.deepEqual([...ENDS_ON_CAUSES], ["damage", "attack"]);
  assert.deepEqual(readEndsOn(["damage", "attack"]), ["damage", "attack"]);
  assert.deepEqual(readEndsOn(["attack", "attack", "sleep", 3, null]), ["attack"], "a word that is no cause is dropped, a cause is kept once");
  assert.deepEqual(readEndsOn("damage"), [], "a flag that is not a list names nothing");
  assert.deepEqual(readEndsOn(undefined), []);
  const all = [effect("d", ["damage"]), effect("a", ["attack"]), effect("b", ["damage", "attack"]), effect("n", []), effect("x"), { flags: { [MODULE_ID]: { [FLAG_ENDS_ON]: ["damage"] } } }];
  assert.deepEqual(endedBy(all, "damage"), ["d", "b"], "by id, only the records naming the cause; an effect with no id is left out");
  assert.deepEqual(endedBy(all, "attack"), ["a", "b"]);
  assert.deepEqual(endedBy(all, "moved"), [], "a word that is no cause ends nothing");
  assert.deepEqual(endedBy(null, "damage"), []);
  ok("readEndsOn keeps the known causes and endedBy names the ids a cause ends");
}

/* --- the catalogue ------------------------------------------------------------- */

{
  assert.deepEqual(CONDITIONS.slumbering.lost, ["damage", "moved"]);
  assert.deepEqual(lostTo(["slumbering", "covered"], "damage"), ["slumbering"]);
  assert.deepEqual(lostTo(["slumbering"], "moved"), ["slumbering"]);
  assert.deepEqual(lostTo(["slumbering"], "save"), [], "a failed save does not wake it");
  ok("slumbering is lost to damage and to a move");
}

/* --- the tracker's half -------------------------------------------------------- */

const { installConditionRolls, loseRecords } = await import("../scripts/lib/status-effects.mjs");

const log = [];
const hooks = {};
const fire = (name, ...args) => (hooks[name] ?? []).forEach((fn) => fn(...args));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const seen = () => log.splice(0, log.length);

class FakeActor {
  constructor(name, { hp = 10, statuses = [] } = {}) {
    this.name = name;
    this.uuid = `Actor.${name}`;
    this.statuses = new Set(statuses);
    this.effects = [];
    this.system = { hp: { value: hp } };
  }
  async toggleStatusEffect(id, { active }) {
    assert.equal(active, false);
    this.statuses.delete(id);
    log.push(`lift ${id}`);
  }
  rollSave() {}
  _calculateMovement() {}
  async deleteEmbeddedDocuments(type, ids) {
    assert.equal(type, "ActiveEffect");
    for (const id of ids) {
      const at = this.effects.findIndex((e) => e.id === id);
      assert.ok(at >= 0, `${id} is on ${this.name}`);
      this.effects.splice(at, 1);
      log.push(`delete ${id}`);
    }
  }
}

/** An actor holding the effects `[id, causes]`, and the hit points it has. */
function bearer(name, records, opts) {
  const actor = new FakeActor(name, opts);
  for (const [id, causes] of records) actor.effects.push(effect(id, causes));
  return actor;
}

/** The hit points fall to `to`: the pre-update marks the operation, the update hands it back. */
async function hurt(actor, to, { user = "me" } = {}) {
  const options = {};
  const changed = { system: { hp: { value: to } } };
  fire("preUpdateActor", actor, changed, options);
  actor.system.hp.value = to;
  fire("updateActor", actor, changed, options, user);
  await tick();
}

const was = { CONFIG: globalThis.CONFIG, Hooks: globalThis.Hooks, ui: globalThis.ui, game: globalThis.game };
globalThis.CONFIG = { Actor: { documentClass: FakeActor } };
globalThis.Hooks = {
  on: (name, fn) => void (hooks[name] ??= []).push(fn),
  callAll: (name, ...args) => fire(name, ...args),
};
globalThis.ui = { notifications: { info: (message) => log.push(`told ${message}`), warn() {} } };
globalThis.game = {
  i18n: { localize: (k) => k, format: (k, data) => `${k} ${JSON.stringify(data ?? {})}` },
  user: { id: "me" },
  users: { activeGM: { isSelf: true } },
  combat: null,
};

try {
  installConditionRolls();

  // Damage ends the records that name it, by id, and no others.
  {
    const actor = bearer("hurt", [["d", ["damage"]], ["a", ["attack"]], ["b", ["damage", "attack"]], ["n", undefined]]);
    await hurt(actor, 4);
    const told = seen();
    assert.deepEqual(told.filter((l) => l.startsWith("delete")), ["delete d", "delete b"], "only the records naming damage are deleted");
    assert.deepEqual(actor.effects.map((e) => e.id), ["a", "n"], "an attack-only record and a plain one stay");
    assert.equal(told.filter((l) => l.startsWith("told")).length, 1, "one notice names what ended");
    assert.ok(told.find((l) => l.startsWith("told")).includes("record d, record b"));
    ok("damage deletes by id the records whose flag names it and leaves the rest");
  }

  // An attack ends the attacker's records that name it.
  {
    const actor = bearer("striker", [["d", ["damage"]], ["a", ["attack"]], ["b", ["damage", "attack"]]]);
    fire(POST_ATTACK_HOOK, actor, { type: "melee" }, { total: 12 });
    await tick();
    assert.deepEqual(seen().filter((l) => l.startsWith("delete")), ["delete a", "delete b"]);
    assert.deepEqual(actor.effects.map((e) => e.id), ["d"], "a record that waits on damage outlives the attack");
    ok("a resolved attack deletes the attacker's own records that name an attack");
  }

  // What is not damage, or not this client's, does nothing.
  {
    const actor = bearer("idle", [["d", ["damage"]]]);
    await hurt(actor, 10);
    await hurt(actor, 12);
    await hurt(actor, 3, { user: "another" });
    assert.deepEqual(seen(), [], "hit points held or raised, and another client's update, end nothing");
    assert.equal(actor.effects.length, 1);
    const bare = bearer("bare", [["n", undefined], ["a", ["attack"]]]);
    await hurt(bare, 1);
    assert.deepEqual(seen(), [], "an actor with no record or state damage costs is not marked");
    ok("a rise, an unchanged figure, another client's update and an actor with nothing to lose end nothing");
  }

  // Slumbering goes to damage and to a move; with a record, the record goes first and each once.
  {
    const sleeper = bearer("sleeper", [], { statuses: ["slumbering"] });
    await hurt(sleeper, 2);
    assert.deepEqual(seen().filter((l) => l.startsWith("lift")), ["lift slumbering"], "damage wakes a slumberer");
    const also = bearer("also", [["rec", ["damage"]]], { statuses: ["slumbering"] });
    await hurt(also, 2);
    assert.deepEqual(seen().filter((l) => !l.startsWith("told")), ["delete rec", "lift slumbering"], "the record, then the state, each once");
    ok("damage lifts slumbering, and a record that ends on damage goes before the state");
  }

  // The same call, made directly: ids come back and a failed delete ends nothing.
  {
    const actor = bearer("direct", [["d", ["damage"]], ["a", ["attack"]]]);
    assert.deepEqual(await loseRecords(actor, "attack"), ["a"]);
    assert.deepEqual(await loseRecords(actor, "attack"), [], "a second call finds nothing to take");
    assert.deepEqual(await loseRecords(actor, "moved"), [], "a word that is no cause takes nothing");
    assert.deepEqual(await loseRecords(null, "damage"), []);
    seen();
    const failing = bearer("failing", [["d", ["damage"]]]);
    failing.deleteEmbeddedDocuments = async () => { throw new Error("refused"); };
    const logged = console.error;
    console.error = () => log.push("error");
    try {
      assert.deepEqual(await loseRecords(failing, "damage"), [], "a refused delete returns no ids");
    } finally {
      console.error = logged;
    }
    assert.deepEqual(seen(), ["error"], "the failure is logged and no notice says it ended");
    ok("loseRecords answers the ids it deleted and survives a refused delete");
  }
} finally {
  for (const [key, value] of Object.entries(was)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
}

console.log(`${passed} ends-on checks passed.`);
