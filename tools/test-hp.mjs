/**
 * The group hit-point tool: the arithmetic that previews core's write
 * (scripts/lib/hp-logic.mjs), whose hit points it may touch, an unlinked
 * token's own hit points and statuses, and how each target is written
 * (scripts/lib/hp.mjs) — through core's `applyDamage`, as a plain update, or
 * into a party token's stash through the party roster.
 */
import assert from "node:assert/strict";
import { HP_MODE, HP_REASON, hpEligibility, ownHitPointsPatch, planHpChange, tokenHasStatus, tokenHitPoints } from "../scripts/lib/hp-logic.mjs";
import { GROUP_TYPE, TEMPLATE_TYPE } from "../scripts/lib/constants.mjs";
import * as services from "../scripts/lib/services.mjs";
import { adjustHp, isFlatAmount, multiplierLabel, resolveTargets, restoreHp } from "../scripts/lib/hp.mjs";

let n = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

/** Core's `AcksActor#applyDamage`, transcribed from the system source, as the oracle. */
function coreApplyDamage(hp, amount, multiplier) {
  const applied = Math.ceil(parseInt(amount) * multiplier);
  return Math.min(Math.max(hp.value - applied, -99), hp.max);
}

t("damage and healing land where core's applyDamage lands, across values, amounts and multipliers", () => {
  for (const value of [-120, -99, -5, 0, 1, 4, 10, 12]) {
    for (const amount of [0, 1, 3, 7, 25, 200]) {
      for (const multiplier of [0, 0.5, 1, 2, 1.5]) {
        const hp = { value, max: 10 };
        const dmg = planHpChange(hp, { mode: HP_MODE.damage, amount, multiplier });
        assert.equal(dmg.after, coreApplyDamage(hp, amount, multiplier), `damage ${amount}×${multiplier} from ${value}`);
        const heal = planHpChange(hp, { mode: HP_MODE.heal, amount, multiplier });
        assert.equal(heal.after, coreApplyDamage(hp, -amount, multiplier), `heal ${amount}×${multiplier} from ${value}`);
      }
    }
  }
});

t("half damage rounds up and half healing rounds toward zero, as core's ceiling does", () => {
  assert.equal(planHpChange({ value: 10, max: 10 }, { amount: 7, multiplier: 0.5 }).after, 6);
  assert.equal(planHpChange({ value: 1, max: 10 }, { mode: HP_MODE.heal, amount: 7, multiplier: 0.5 }).after, 4);
});

t("a set is held between core's floor and the maximum, and ignores the multiplier", () => {
  const hp = { value: 4, max: 10 };
  assert.equal(planHpChange(hp, { mode: HP_MODE.set, amount: 7, multiplier: 0 }).after, 7);
  assert.equal(planHpChange(hp, { mode: HP_MODE.set, amount: 30 }).after, 10);
  assert.equal(planHpChange(hp, { mode: HP_MODE.set, amount: -300 }).after, -99);
  assert.equal(planHpChange(hp, { mode: HP_MODE.set, amount: 30 }).clamped, true);
});

t("stop at 0 holds damage at 0 and never raises a value already below it", () => {
  assert.equal(planHpChange({ value: 5, max: 10 }, { amount: 8, floorAtZero: true }).after, 0);
  assert.equal(planHpChange({ value: 5, max: 10 }, { amount: 3, floorAtZero: true }).after, 2);
  assert.equal(planHpChange({ value: -2, max: 10 }, { amount: 3, floorAtZero: true }).after, -2);
  // Only damage is held: healing and a set are untouched by it.
  assert.equal(planHpChange({ value: -2, max: 10 }, { mode: HP_MODE.set, amount: -6, floorAtZero: true }).after, -6);
});

t("a plan says when it crosses 0 in either direction", () => {
  const down = planHpChange({ value: 3, max: 10 }, { amount: 3 });
  assert.deepEqual([down.crossedDown, down.crossedUp, down.delta], [true, false, -3]);
  const up = planHpChange({ value: 0, max: 10 }, { mode: HP_MODE.heal, amount: 2 });
  assert.deepEqual([up.crossedDown, up.crossedUp, up.delta], [false, true, 2]);
  const neither = planHpChange({ value: -1, max: 10 }, { amount: 2 });
  assert.deepEqual([neither.crossedDown, neither.crossedUp], [false, false]);
});

t("a plan needs numbers: no hit points or an unreadable amount plans nothing", () => {
  assert.equal(planHpChange(null, { amount: 3 }), null);
  assert.equal(planHpChange({ value: 3 }, { amount: 3 }), null);
  assert.equal(planHpChange({ value: 3, max: 5 }, { amount: "d6" }), null);
  assert.equal(planHpChange({ value: 3, max: 5 }, { amount: 2, multiplier: "x" }), null);
});

t("a stack, a template, a vehicle and anything without hit points are left out with their reason", () => {
  const hp = { value: 4, max: 8 };
  assert.equal(hpEligibility({ type: "character", system: { hp } }), null);
  assert.equal(hpEligibility({ type: "monster", system: { hp } }), null);
  assert.equal(hpEligibility(null), HP_REASON.missing);
  assert.equal(hpEligibility({ type: GROUP_TYPE, system: { hp } }), HP_REASON.stack);
  assert.equal(hpEligibility({ type: TEMPLATE_TYPE, system: { hp } }), HP_REASON.template);
  assert.equal(hpEligibility({ type: "acks-extras.vehicle", system: {} }), HP_REASON.vehicle);
  assert.equal(hpEligibility({ type: "acks-extras.party", system: {} }), HP_REASON.noHp);
});

t("an unlinked token's own hit points: a live token's actor, else the stash's delta, else the base", () => {
  const base = { system: { hp: { value: 10, max: 10 } } };
  // Stashed data, as `tokenDoc.toObject()` leaves it.
  assert.deepEqual(tokenHitPoints({ actorLink: false, delta: { system: { hp: { value: 0 } } } }, base), { value: 0, max: 10 });
  assert.deepEqual(tokenHitPoints({ actorLink: false, delta: { system: { hp: { value: 3, max: 6 } } } }, base), { value: 3, max: 6 });
  assert.deepEqual(tokenHitPoints({ actorLink: false, delta: { system: {} } }, base), { value: 10, max: 10 });
  // A live token answers through its synthetic actor.
  assert.deepEqual(tokenHitPoints({ actorLink: false, actor: { system: { hp: { value: 2, max: 9 } } } }, base), { value: 2, max: 9 });
  // A linked token is the base actor, whatever its delta says.
  assert.deepEqual(tokenHitPoints({ actorLink: true, delta: { system: { hp: { value: 0 } } } }, base), { value: 10, max: 10 });
  assert.deepEqual(tokenHitPoints(null, base), { value: 10, max: 10 });
  assert.equal(tokenHitPoints({ actorLink: false, delta: {} }, null), null);
  // A token that matches its actor keeps no delta at all.
  assert.deepEqual(tokenHitPoints({ actorLink: false, delta: null }, base), { value: 10, max: 10 });
});

t("a token re-created from data is patched back to that data's own hit points", () => {
  const base = { system: { hp: { value: 10, max: 10 } } };
  assert.deepEqual(ownHitPointsPatch({ actorLink: false, delta: { system: { hp: { value: 2 } } } }, base), { system: { hp: { value: 2, max: 10 } } });
  // No delta: the base actor's, so a roll on creation cannot stand.
  assert.deepEqual(ownHitPointsPatch({ actorLink: false, delta: null }, base), { system: { hp: { value: 10, max: 10 } } });
  assert.deepEqual(ownHitPointsPatch({ actorLink: false, delta: { system: { hp: { value: 4 } } } }, null), { system: { hp: { value: 4 } } });
  assert.equal(ownHitPointsPatch({ actorLink: true, delta: { system: { hp: { value: 2 } } } }, base), null);
  assert.equal(ownHitPointsPatch({ actorLink: false, delta: null }, null), null);
  assert.equal(ownHitPointsPatch(null, base), null);
});

t("an unlinked token's statuses lay its delta's effects over the base actor's by id", () => {
  const base = {
    statuses: new Set(["dead"]),
    effects: [{ id: "e1", statuses: new Set(["dead"]), disabled: false }],
  };
  const stash = (effects) => ({ actorLink: false, delta: { effects } });
  assert.equal(tokenHasStatus(stash([]), base, "dead"), true);
  // The delta's copy of the same effect, disabled, is what the token has.
  assert.equal(tokenHasStatus(stash([{ _id: "e1", statuses: ["dead"], disabled: true }]), base, "dead"), false);
  assert.equal(tokenHasStatus(stash([{ _id: "e2", statuses: ["dead"] }]), { effects: [] }, "dead"), true);
  assert.equal(tokenHasStatus(stash([{ _id: "e2", statuses: ["prone"] }]), { effects: [] }, "dead"), false);
  assert.equal(tokenHasStatus({ actorLink: false, actor: { statuses: new Set() } }, base, "dead"), false);
  assert.equal(tokenHasStatus({ actorLink: true }, base, "dead"), true);
});

t("an amount is flat only as a whole number; a multiplier prints nothing at ×1", () => {
  assert.equal(isFlatAmount("7"), true);
  assert.equal(isFlatAmount(" -3 "), true);
  assert.equal(isFlatAmount("2d6"), false);
  assert.equal(isFlatAmount("1.5"), false);
  assert.equal(multiplierLabel(1), "");
  assert.equal(multiplierLabel(0.5), "×½");
  assert.equal(multiplierLabel(2), "×2");
  assert.equal(multiplierLabel(0), "×0");
});

/* --- The writes, over mock documents --- */

const writes = [];

/** A world actor or a token's synthetic actor with core's two write paths. */
function actor({ id, name, hp, type = "character", token = null }) {
  const doc = {
    id,
    name,
    type,
    img: "",
    uuid: token ? `Scene.s1.Token.${token}.Actor.${id}` : `Actor.${id}`,
    isToken: !!token,
    system: { hp: { ...hp } },
    async applyDamage(amount, multiplier) {
      writes.push(["applyDamage", doc.uuid, amount, multiplier]);
      doc.system.hp.value = coreApplyDamage(doc.system.hp, amount, multiplier);
    },
    async update(changes) {
      writes.push(["update", doc.uuid, changes]);
      doc.system.hp.value = changes["system.hp.value"];
    },
  };
  return doc;
}

function world(...actors) {
  const map = new Map(actors.map((a) => [a.id, a]));
  globalThis.game = { actors: map, user: { isGM: true } };
}

t("linked tokens of one actor make one row; an unlinked token is its own row", () => {
  const hero = actor({ id: "a1", name: "Hero", hp: { value: 10, max: 10 } });
  const goblin = actor({ id: "a2", name: "Goblin", hp: { value: 4, max: 4 }, type: "monster", token: "t9" });
  world(hero);
  services.resetServices();
  const rows = resolveTargets({
    tokens: [
      { actorLink: true, actor: hero, name: "Hero" },
      { document: { actorLink: true, actor: hero, name: "Hero" } },
      { actorLink: false, actor: goblin, name: "Goblin 1" },
    ],
  });
  assert.deepEqual(rows.map((r) => [r.key, r.name]), [["Actor.a1", "Hero"], ["Scene.s1.Token.t9.Actor.a2", "Goblin 1"]]);
});

t("a stack becomes its bodies on the map, and is one row left out while none is", () => {
  const group = { id: "g1", uuid: "Actor.g1", name: "Guards", type: GROUP_TYPE, img: "", system: { hp: { value: 5, max: 5 } } };
  /** A deployed body: an unlinked token flagged with its group's uuid. */
  const body = (n, groupUuid = group.uuid) => ({
    actorLink: false,
    name: `Guard ${n}`,
    actor: actor({ id: `b${n}`, name: "Guard", hp: { value: 5, max: 5 }, type: "monster", token: `t${n}` }),
    getFlag: (scope, key) => (scope === "acks-extras" && key === "group" ? groupUuid : undefined),
  });
  world();
  services.resetServices();
  game.scenes = [{ tokens: [body(1), body(2, "Actor.other")] }, { tokens: [body(3)] }];
  const rows = resolveTargets({ actors: [group] });
  assert.deepEqual(rows.map((r) => [r.key, r.name, r.reason]), [
    ["Scene.s1.Token.t1.Actor.b1", "Guard 1", null],
    ["Scene.s1.Token.t3.Actor.b3", "Guard 3", null],
  ]);
  // Through a party, the bodies carry the party's name.
  services.register("party-roster", {
    list: () => [{ id: "p1", name: "The Party" }],
    partyOf: () => null,
    members: () => [{ actorId: "g1", actor: group, name: "Guards", document: null, hp: { value: 5, max: 5 } }],
  });
  assert.deepEqual(resolveTargets({ parties: ["p1"] }).map((r) => [r.name, r.partyName]), [
    ["Guard 1", "The Party"],
    ["Guard 3", "The Party"],
  ]);
  game.scenes = [];
  assert.deepEqual(resolveTargets({ actors: [group] }).map((r) => [r.key, r.reason]), [["Actor.g1", HP_REASON.stack]]);
});

t("a party token becomes its members, and a stashed unlinked member is written into the stash", async () => {
  const hero = actor({ id: "a1", name: "Hero", hp: { value: 10, max: 10 } });
  world(hero);
  services.resetServices();
  const stash = { value: 6, max: 6 };
  services.register("party-roster", {
    list: () => [{ id: "p1", name: "The Party" }],
    partyOf: (token) => (token.isParty ? "p1" : null),
    members: () => [
      { actorId: "a1", actor: hero, name: "Hero", document: hero, hp: { value: 10, max: 10 } },
      { actorId: "a3", actor: { type: "monster", system: { hp: { value: 6, max: 6 } } }, name: "Mule", document: null, hp: { ...stash } },
    ],
    async adjustStashedHp(party, actorId, next) {
      const after = next({ ...stash });
      writes.push(["stash", party, actorId, after]);
      const before = stash.value;
      stash.value = after;
      return { before, after, max: stash.max };
    },
  });
  const rows = resolveTargets({ tokens: [{ isParty: true }] });
  assert.deepEqual(rows.map((r) => r.key), ["Actor.a1", "party.p1.a3"]);
  assert.equal(rows[1].partyName, "The Party");
  writes.length = 0;
  const results = await adjustHp(rows.map((target) => ({ target, amount: 7 })), { mode: HP_MODE.damage });
  assert.deepEqual(writes, [["applyDamage", "Actor.a1", 7, 1], ["stash", "p1", "a3", -1]]);
  assert.deepEqual(results.map((r) => [r.before, r.after, r.crossedDown]), [[10, 3, false], [6, -1, true]]);
});

t("damage held at 0 and a set are written as updates; the rest through core; no change writes nothing", async () => {
  const hero = actor({ id: "a1", name: "Hero", hp: { value: 5, max: 10 } });
  world(hero);
  services.resetServices();
  const [row] = resolveTargets({ actors: [hero] });
  writes.length = 0;
  await adjustHp([{ target: row, amount: 8 }], { mode: HP_MODE.damage, floorAtZero: true });
  assert.deepEqual(writes, [["update", "Actor.a1", { "system.hp.value": 0 }]]);
  writes.length = 0;
  // The floor does not bind here, so core writes it.
  await adjustHp([{ target: row, amount: -4 }], { mode: HP_MODE.damage, floorAtZero: true });
  assert.deepEqual(writes, [["applyDamage", "Actor.a1", -4, 1]]);
  writes.length = 0;
  await adjustHp([{ target: row, amount: 9 }], { mode: HP_MODE.set });
  assert.deepEqual(writes, [["update", "Actor.a1", { "system.hp.value": 9 }]]);
  writes.length = 0;
  await adjustHp([{ target: row, amount: 5, multiplier: 0 }], { mode: HP_MODE.damage });
  assert.deepEqual(writes, []);
});

t("undo sets each written target back, and a deleted actor fails without stopping the rest", async () => {
  const hero = actor({ id: "a1", name: "Hero", hp: { value: 10, max: 10 } });
  const gone = actor({ id: "a2", name: "Gone", hp: { value: 10, max: 10 } });
  world(hero, gone);
  services.resetServices();
  const rows = resolveTargets({ actors: [gone, hero] });
  game.actors.delete("a2");
  const results = await adjustHp(rows.map((target) => ({ target, amount: 4 })), { mode: HP_MODE.damage });
  assert.deepEqual(results.map((r) => [r.ok, r.why ?? null]), [[false, "gone"], [true, null]]);
  assert.equal(hero.system.hp.value, 6);
  writes.length = 0;
  const restored = await restoreHp(results);
  assert.equal(hero.system.hp.value, 10);
  assert.deepEqual(writes, [["update", "Actor.a1", { "system.hp.value": 10 }]]);
  assert.deepEqual(restored.map((r) => [r.before, r.after]), [[6, 10]]);
});

for (const [name, fn] of tests) {
  await fn();
  n++;
  console.log(`ok - ${name}`);
}
console.log(`\n${n} tests passed`);
