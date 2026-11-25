/**
 * The fuse-lit bomb's pure half (`item-run-logic.mjs`, `aura-reach-logic.mjs`),
 * offline: the activation's new figures as `readItemRun` hands them over, the
 * reach's `fraction`, the blast a breed's bomb deals, what the lighting throw
 * did, what a burst does to a subject that saved or did not, a fuse lit outside
 * a fight on the world clock, a lit fuse bursting on the bearer's Nth turn end,
 * and an Undo that gives back hit points. Foundry-free; every size, die, edge
 * and fraction below is invented.
 *
 * Usage: node tools/test-item-run-fuse.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
class ForcedDeletion {}
globalThis.foundry = { utils: { randomID: () => "rid" }, data: { operators: { ForcedDeletion } } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: true }, time: { worldTime: 0 } };

const logic = await import("../scripts/lib/item-run-logic.mjs");
const reach = await import("../scripts/lib/aura-reach-logic.mjs");
const T = await import("../scripts/lib/tables.mjs");
const { THROWS_DOC, THROW_TABLE } = await import("../scripts/lib/throws.mjs");

let passed = 0;
const t = async (name, fn) => {
  T.unregisterTable(THROWS_DOC);
  await fn();
  T.unregisterTable(THROWS_DOC);
  passed += 1;
  console.log(`ok - ${name}`);
};

/** Invented natural-die edges, registered the way an import registers them. */
const importThrows = (cells = { autoFailMax: 5, autoSucceedMin: 17 }) =>
  T.registerTable({ id: THROWS_DOC, source: { pages: "ZZ p. 1" }, tables: { [THROW_TABLE]: cells } }, { priority: T.PRIORITY.WORLD });

const spot = { sceneId: "s1", x: 100, y: 200, elevation: 0, level: "l1" };

await t("the activation hands over its fuse figures as references and its variant trimmed", () => {
  const sizes = { value: "x" };
  const read = logic.readItemRun({
    activation: { kind: "fuse", throw: { doc: "d" }, fumble: { doc: "f" }, fuseDice: { doc: "u" }, proficiency: { value: "p" }, sizes, blast: { doc: "b" }, variant: "  kindA " },
    rows: [{ key: "burst" }],
  });
  assert.deepEqual(read.activation.proficiency, { value: "p" });
  assert.equal(read.activation.sizes, sizes);
  assert.deepEqual(read.activation.blast, { doc: "b" });
  assert.equal(read.activation.variant, "kindA");
  assert.deepEqual(read.activation.throw, { doc: "d" }, "the figures it already read stay");
  assert.deepEqual(read.activation.fuseDice, { doc: "u" });
  assert.deepEqual(read.rows, [{ key: "burst" }]);
  const bare = logic.readItemRun({ activation: { kind: "fuse", proficiency: "p", sizes: 3, blast: null, variant: 7 } }).activation;
  assert.equal(bare.proficiency, null, "a bare string is no reference");
  assert.equal(bare.sizes, null);
  assert.equal(bare.blast, null);
  assert.equal(bare.variant, "", "a variant that is no string is none");
  assert.equal(logic.readItemRun({ activation: { kind: "fuse" } }).activation.variant, "");
});

await t("a burst row's reach reads its fraction as a reference and resolves it to a number, blank to null", () => {
  assert.equal(reach.readReach({ pulse: "burst", fraction: { value: "0.4" } }).fraction.value, "0.4");
  assert.equal(reach.readReach({ pulse: "burst" }).fraction, null, "none stored");
  assert.equal(reach.readReach({ pulse: "burst", fraction: "0.4" }).fraction, null, "a bare string is no reference");
  const read = (doc, table, row, figure) => (doc === "docZ" && table === "tabZ" && row === "rowZ" && figure === "fracZ" ? 0.4 : undefined);
  const byTable = { pulse: "burst", fraction: { doc: "docZ", table: "tabZ", row: "rowZ", figure: "fracZ" } };
  assert.equal(logic.reachFigures({ reach: byTable }, read).fraction, 0.4, "read live off the table");
  assert.equal(logic.reachFigures({ reach: { pulse: "burst", fraction: { value: "0.25" } } }, read).fraction, 0.25, "the row's own value");
  assert.equal(logic.reachFigures({ reach: { pulse: "burst", fraction: { value: "" } } }, read).fraction, null, "a blank reference is null");
  assert.equal(logic.reachFigures({ reach: { pulse: "burst", fraction: { doc: "docZ", table: "tabZ", row: "rowZ", figure: "other" } } }, read).fraction, null, "a figure nobody imported");
  assert.equal(logic.reachFigures({ reach: { pulse: "burst" } }, read).fraction, null);
  assert.equal(logic.reachFigures({ reach: { pulse: "burst", fraction: { value: "word" } } }, read).fraction, null, "a figure that is no number");
});

await t("a breed's blast joins its size to the blast row on the size", () => {
  const sizes = { kindA: 7, kindB: "9", kindC: 11, kindD: "", kindE: null };
  const blast = [
    { lb: 7, dice: "3d5", radius: 11, types: ["typeA", "typeB"] },
    { lb: 9, dice: "2d4", radius: "13" },
    { lb: 11, dice: "", radius: 15 },
  ];
  assert.deepEqual(logic.blastOf({ sizes, blast, variant: "kindA" }), { dice: "3d5", radius: 11, types: ["typeA", "typeB"] });
  assert.deepEqual(logic.blastOf({ sizes, blast, variant: " kindB " }), { dice: "2d4", radius: 13, types: [] }, "types absent on an older import; a size and a radius as text join");
  assert.equal(logic.blastOf({ sizes, blast, variant: "unknown" }), null, "an unknown variant");
  assert.equal(logic.blastOf({ sizes, blast, variant: "" }), null, "no variant");
  assert.equal(logic.blastOf({ sizes, blast, variant: "kindD" }), null, "a blank size");
  assert.equal(logic.blastOf({ sizes, blast, variant: "kindE" }), null, "a null size");
  assert.equal(logic.blastOf({ sizes, blast, variant: "kindC" }), null, "a row with no dice");
  assert.equal(logic.blastOf({ sizes: { kindF: 8 }, blast, variant: "kindF" }), null, "no row for the size");
  assert.equal(logic.blastOf({ sizes, blast: [{ lb: 7, dice: "3d5" }], variant: "kindA" }), null, "a row with no radius");
  assert.equal(logic.blastOf({ sizes, blast: null, variant: "kindA" }), null);
  assert.equal(logic.blastOf({ sizes: null, blast, variant: "kindA" }), null);
});

await t("the light: a fumble, a lit fuse and an unlit one, and the natural die as throws.mjs reads it", () => {
  importThrows();
  const roll = (over) => logic.fuseLight({ natural: 10, total: 10, target: 12, fumble: 2, proficient: true, ...over });
  assert.equal(roll({ natural: 2, total: 30 }), "fumble", "in the band whatever the total");
  assert.equal(roll({ natural: 1, total: 30 }), "fumble", "below the band's edge too");
  assert.equal(roll({ natural: 3, total: 30 }), "unlit", "an automatic failure is never lit by a high total");
  assert.equal(roll({ natural: 8, total: 12 }), "lit", "a total on the target");
  assert.equal(roll({ natural: 8, total: 11 }), "unlit", "a total under it");
  assert.equal(roll({ natural: 17, total: 5 }), "lit", "a proficient bearer's natural top edge succeeds");
  assert.equal(roll({ natural: 17, total: 5, proficient: false }), "unlit", "a bearer without the proficiency has no automatic success");
  assert.equal(roll({ natural: 17, total: 13, proficient: false }), "lit", "and is held to the target");
  assert.equal(roll({ natural: 17, total: 5, target: null }), "lit", "an automatic result never consults the target");
  assert.equal(roll({ natural: 8, total: 12, target: null }), null, "a blank target is the Judge's");
  assert.equal(roll({ natural: 8, total: 12, fumble: null }), null, "a blank fumble figure is the Judge's");
  assert.equal(roll({ natural: 2, fumble: null }), null, "even for a low natural");
  assert.equal(roll({ natural: "x" }), null, "a natural that is no number");
});

await t("with no natural-die figures imported the target alone decides, and nothing is guessed", () => {
  const roll = (over) => logic.fuseLight({ natural: 10, total: 10, target: 12, fumble: 2, proficient: true, ...over });
  assert.equal(roll({ natural: 20, total: 5 }), "unlit");
  assert.equal(roll({ natural: 4, total: 15 }), "lit");
  assert.equal(roll({ natural: 2, total: 15 }), "fumble");
  assert.equal(roll({ natural: 20, total: 5, proficient: undefined }), "unlit", "an unstated proficiency is never an automatic success");
});

await t("a burst's amount: the failed save takes it whole, a saved subject the fraction, a blank fraction is the Judge's", () => {
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: false, reduction: 0.5 }), { amount: 20, judge: false });
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: false, reduction: null }), { amount: 20, judge: false }, "a failed save needs no fraction");
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: true, reduction: 0.5 }), { amount: 10, judge: false });
  assert.deepEqual(logic.burstAmount({ rolled: 9, saved: true, reduction: 0.6 }), { amount: 4, judge: false }, "one rounding at the end");
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: true, reduction: null }), { amount: null, judge: true });
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: true, reduction: undefined }), { amount: null, judge: true });
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: false, reduction: null, stages: [{ factor: 0.5 }] }), { amount: 10, judge: false }, "a defense stage");
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: true, reduction: 0.5, stages: [{ minus: 3 }] }), { amount: 7, judge: false }, "the fraction, then the stage");
  assert.deepEqual(logic.burstAmount({ rolled: 20, saved: false, reduction: 0.5, stages: [{ judge: true }] }), { amount: null, judge: true }, "a stage the module does not compute");
  assert.deepEqual(logic.burstAmount({ rolled: "x", saved: false, reduction: 0.5 }), { amount: null, judge: true }, "no roll to apply");
});

await t("a fuse lit outside a fight is the world-clock record fuseToWorld would have made", () => {
  const raw = logic.fuseFlag({ source: "I.1", activationId: "act", spot, combatId: "c1", combatantId: "m1", count: 5 });
  for (const [rounds, seen, now, secs] of [[5, 0, 1000, 6], [3, 2, 10, 2.5], [4, 0, 10, 2.2], [1, 0, 0, 6.5]]) {
    const stored = { ...raw, clock: { ...raw.clock, count: seen + rounds, seen } };
    const viaFight = logic.fuseToWorld(stored, "c1", { now, roundSeconds: secs });
    const lit = logic.fuseWorldFlag({ source: "I.1", activationId: "act", spot, rounds, now, roundSeconds: secs });
    assert.deepEqual(lit, viaFight, `${rounds} rounds from ${now} at ${secs}s`);
  }
  const lit = logic.fuseWorldFlag({ source: "I.1", activationId: "act", spot, rounds: 2, now: 100, roundSeconds: 6 });
  assert.deepEqual(lit, { source: "I.1", activationId: "act", spot, dueAt: 112 });
  assert.deepEqual(logic.readFuse(lit), lit, "readFuse takes it as a world-clock fuse");
  assert.equal(logic.fuseDue(lit, 111), false);
  assert.equal(logic.fuseDue(lit, 112), true);
  assert.equal(logic.fuseStep(lit, { kind: "ended", combatId: "c1", combatantId: "m1" }).act, "none", "a turn never touches it");
  assert.equal(logic.fuseWorldFlag({ source: "I.1", activationId: "act", spot, rounds: null, now: 100, roundSeconds: 6 }), null);
  assert.equal(logic.fuseWorldFlag({ source: "I.1", activationId: "act", spot, rounds: 2, now: undefined, roundSeconds: 6 }), null);
  assert.equal(logic.fuseWorldFlag({ source: "I.1", activationId: "act", spot, rounds: 2, now: 100, roundSeconds: 0 }), null);
});

await t("a lit fuse on the fight's clock bursts at the end of the bearer's Nth turn after it was lit, and no sooner", () => {
  importThrows();
  const lit = logic.fuseLight({ natural: 9, total: 14, target: 12, fumble: 2, proficient: true });
  assert.equal(lit, "lit");
  let raw = logic.fuseFlag({ source: "I.1", activationId: "act", spot, combatId: "c1", combatantId: "m1", count: 2 });
  const acts = [];
  const feed = (kind, who = "m1") => {
    const step = logic.fuseStep(raw, { kind, combatId: "c1", combatantId: who });
    acts.push(step.act);
    if (step.act === "count") raw = { ...raw, clock: { ...raw.clock, seen: step.seen } };
    return step;
  };
  feed("ended");
  feed("began", "other");
  feed("began");
  feed("ended");
  feed("began");
  assert.deepEqual(acts, ["none", "none", "count", "none", "count"]);
  const last = feed("ended");
  assert.equal(last.act, "burst", "the end of the second turn that began after it was lit");
  assert.equal(last.record.spot, spot);
  assert.equal(last.record.source, "I.1");
});

await t("Undo plans the ids still there and gives back the hit points a press took", () => {
  const plain = logic.undoPlan({ recordIds: ["a", "b", "a"] }, ["b", "z"]);
  assert.deepEqual(plain, { ids: ["b"], gone: ["a"], hp: [] }, "an entry with no hit points reverses none");
  assert.deepEqual(logic.undoPlan(undefined, undefined), { ids: [], gone: [], hp: [] });
  const taken = logic.undoPlan({ recordIds: ["a"], hp: [{ uuid: "Actor.1", amount: 6 }, { uuid: "Actor.2", amount: -4 }] }, ["a"]);
  assert.deepEqual(taken, { ids: ["a"], gone: [], hp: [{ uuid: "Actor.1", amount: -6 }, { uuid: "Actor.2", amount: 4 }] }, "damage given back is negative, a heal taken back positive");
  assert.deepEqual(logic.undoPlan({ hp: [{ uuid: "Actor.1", amount: 0 }, { uuid: "", amount: 3 }, { uuid: "Actor.3", amount: "x" }, null] }, []).hp, [], "nothing that is no amount, no body or no change");
  assert.deepEqual(logic.undoPlan({ hp: "x" }, []).hp, [], "a stored list that is no list");
  assert.deepEqual(logic.undoPlan({ hp: [{ uuid: "Actor.1", amount: "5" }] }, []).hp, [{ uuid: "Actor.1", amount: -5 }], "an amount stored as text");
});

console.log(`\ntest-item-run-fuse: ${passed} checks passed.`);
