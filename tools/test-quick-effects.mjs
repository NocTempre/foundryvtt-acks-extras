/**
 * abilities/quick-effects.mjs: which imported modifier rows offer a quick
 * effect, what it writes, that a row which does not apply by itself starts
 * off, and when it reads stale.
 *
 * Every figure here is invented. Run: node tools/test-quick-effects.mjs
 */
import assert from "node:assert/strict";

globalThis.acksExtras = {};
globalThis.game = { i18n: { localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };

const { quickEffectPlan, quickEffectStatus, startQuickEffect, refreshQuickEffect, QUICK_FLAG, QUICK_EFFECT_ACTIONS } = await import("../scripts/abilities/quick-effects.mjs");

let pass = 0;
const check = async (label, fn) => {
  try {
    await fn();
    pass++;
  } catch (err) {
    console.error(`FAIL ${label}`);
    throw err;
  }
};

/** An ability copy on a character, whose embedded effects are an array the mock writes into. */
function setup(effects, { level = 1, type = "character", name = "Steady" } = {}) {
  const actor = { type, system: { details: { level } }, items: [] };
  const item = {
    id: "i1",
    name,
    img: "x.webp",
    type: "ability",
    actor,
    flags: { "acks-extras": { extras: { effects } } },
    effects: [],
    async createEmbeddedDocuments(kind, data) {
      assert.equal(kind, "ActiveEffect");
      const made = data.map((d) => {
        const effect = {
          ...d,
          getFlag: (m, k) => effect.flags?.[m]?.[k],
          async update(u) {
            if (u.changes) effect.changes = u.changes;
            effect.flags["acks-extras"][QUICK_FLAG] = u[`flags.acks-extras.${QUICK_FLAG}`];
          },
        };
        return effect;
      });
      item.effects.push(...made);
      return made;
    },
  };
  actor.items.push(item);
  return { actor, item };
}
const flat = (n) => ({ kind: "flat", flat: n });

await check("a standing row offers an effect that starts on and writes its field", async () => {
  const { item } = setup([{ type: "modifier", target: "ac", value: flat(2) }]);
  const plan = quickEffectPlan(item, 0);
  assert.equal(plan.startsOff, false);
  assert.deepEqual(plan.changes, [{ key: "system.ac.mod", type: "add", value: "2", priority: 20 }]);
  const made = await startQuickEffect(item, 0);
  assert.equal(made.disabled, false);
  assert.equal(made.transfer, true);
  assert.equal(quickEffectStatus(item, 0).state, "on");
  assert.equal(await startQuickEffect(item, 0), null, "a second Start makes nothing");
});
await check("a situational row starts off, and its name says so", async () => {
  const { item } = setup([{ type: "modifier", target: "save", value: flat(3), condition: "situational" }]);
  const made = await startQuickEffect(item, 0);
  assert.equal(made.disabled, true);
  assert.ok(made.name.startsWith("ACKS-ABILITIES.quick.nameOff"));
  assert.equal(quickEffectStatus(item, 0).state, "off");
});
await check("a gated row and a row scoped to the roll start off too, writing the field they name", async () => {
  const gated = setup([{ type: "modifier", target: "initiative", value: flat(1), gate: { kind: "noSuchGate" } }]).item;
  assert.equal(quickEffectPlan(gated, 0).startsOff, true);
  const scoped = setup([{ type: "modifier", target: "ac", value: flat(1), vsKinds: ["undead"] }]).item;
  const plan = quickEffectPlan(scoped, 0);
  assert.equal(plan.startsOff, true);
  assert.equal(plan.changes[0].key, "system.ac.mod");
});
await check("a one-save row writes that save's target, lowered", async () => {
  const { item } = setup([{ type: "modifier", target: "save", forWhat: "Paralysis", value: flat(2), condition: "situational" }]);
  assert.deepEqual(quickEffectPlan(item, 0).changes, [{ key: "system.saves.paralysis.value", type: "subtract", value: "2", priority: 20 }]);
});
await check("rows with no field, another reader, no value or no owner offer nothing", async () => {
  assert.equal(quickEffectPlan(setup([{ type: "modifier", target: "reaction", value: flat(1) }]).item, 0), null);
  assert.equal(quickEffectPlan(setup([{ type: "modifier", target: "speed", value: flat(1) }]).item, 0), null);
  assert.equal(quickEffectPlan(setup([{ type: "modifier", target: "ac", value: { kind: "progression", table: "x" } }]).item, 0), null);
  assert.equal(quickEffectPlan(setup([{ type: "throw", value: flat(1) }]).item, 0), null);
  const loose = setup([{ type: "modifier", target: "ac", value: flat(1) }]).item;
  loose.actor = null;
  assert.equal(quickEffectPlan(loose, 0), null);
});
await check("a monster's copy offers nothing", async () => {
  assert.equal(quickEffectPlan(setup([{ type: "modifier", target: "ac", value: flat(1) }], { type: "monster" }).item, 0), null);
});
await check("a level change makes a ladder's effect stale, and Refresh rewrites it keeping its state", async () => {
  const ladder = { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 1 }, { atLevel: 3, value: 2 }] };
  const { actor, item } = setup([{ type: "modifier", target: "ac", value: ladder, condition: "situational" }]);
  const made = await startQuickEffect(item, 0);
  assert.equal(made.changes[0].value, "1");
  actor.system.details.level = 3;
  assert.equal(quickEffectStatus(item, 0).state, "stale");
  await refreshQuickEffect(item, 0);
  assert.equal(made.changes[0].value, "2");
  assert.equal(made.disabled, true, "Refresh keeps the effect off");
  assert.equal(quickEffectStatus(item, 0).state, "off");
  assert.equal(await refreshQuickEffect(item, 0), null, "nothing stale, nothing written");
});
await check("the sheet actions refuse a sheet that is not editable", async () => {
  const { item } = setup([{ type: "modifier", target: "ac", value: flat(1) }]);
  await QUICK_EFFECT_ACTIONS.quickEffectStart.call({ item, isEditable: false }, null, { dataset: { effectIndex: "0" } });
  assert.equal(item.effects.length, 0);
  await QUICK_EFFECT_ACTIONS.quickEffectStart.call({ item, isEditable: true }, null, { dataset: { effectIndex: "0" } });
  assert.equal(item.effects.length, 1);
});

await check("an enabled quick effect stands its row aside, so the figure counts once; an off one does not", async () => {
  const { standingModifiers } = await import("../scripts/lib/typed-modifiers.mjs");
  const { actor, item } = setup([{ type: "modifier", target: "ac", value: flat(2) }]);
  const made = await startQuickEffect(item, 0);
  let r = standingModifiers(actor);
  assert.equal(r.parts.length, 0);
  assert.equal(r.listed[0].reason, "standAside");
  made.disabled = true;
  r = standingModifiers(actor);
  assert.equal(r.parts.length, 1);
});

console.log(`test-quick-effects: ${pass} passed`);
