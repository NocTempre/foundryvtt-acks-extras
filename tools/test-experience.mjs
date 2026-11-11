/**
 * Experience credited to an actor (`scripts/lib/experience.mjs`): a character
 * through the system's own call, a monster or an animal onto its flag, and the
 * Service panel's row over the flag. Actors are hand-built doubles and every
 * figure is invented.
 *
 * Not registered in `tools/run-tests.mjs`; run it directly:
 *   node tools/test-experience.mjs
 */
import assert from "node:assert/strict";
import {
  EXPERIENCE_FLAG, DEFAULT_SOURCE, addCredit, normalizeStore, creditedExperience, creditExperience, keepsExperienceOnFlag,
} from "../scripts/lib/experience.mjs";
import { ANIMAL_TYPE } from "../scripts/lib/constants.mjs";
import { divideXp, awardXp } from "../scripts/formation/xp-shares.mjs";

/** An actor double whose flags are a plain object, so a write can be read back. */
const actor = (type, extra = {}) => {
  const flags = {};
  const writes = [];
  return {
    type, flags, writes, ...extra,
    getFlag: (_m, k) => (k === "record" ? extra.record ?? null : flags[k] ?? null),
    setFlag: async (_m, k, v) => { writes.push([k, v]); flags[k] = v; },
  };
};

/* --- the pure half ------------------------------------------------------- */
assert.deepEqual(addCredit(null, 70, "deal"), { bySource: { deal: 70 } });
assert.deepEqual(addCredit({ bySource: { deal: 70 } }, 30, "deal"), { bySource: { deal: 100 } }, "one source accumulates");
assert.deepEqual(addCredit({ bySource: { deal: 70 } }, 25, "gift"), { bySource: { deal: 70, gift: 25 } }, "a second source is its own part");
assert.deepEqual(addCredit(null, 40), { bySource: { [DEFAULT_SOURCE]: 40 } }, "no source named, the default one");
for (const bad of [0, -5, NaN, "x", null, undefined]) {
  assert.deepEqual(addCredit({ bySource: { deal: 70 } }, bad, "deal"), { bySource: { deal: 70 } }, `${bad} adds nothing`);
}
const stored = { bySource: { deal: 70 } };
addCredit(stored, 30, "deal");
assert.deepEqual(stored, { bySource: { deal: 70 } }, "the input store is never mutated");
assert.deepEqual(normalizeStore({ bySource: { deal: "12", bad: "x", neg: -3, "": 9 } }), { bySource: { deal: 12 } },
  "a hand-edited flag keeps only what reads as a positive tally under a name");
assert.deepEqual(normalizeStore("garbage"), { bySource: {} });
assert.deepEqual(normalizeStore(undefined), { bySource: {} });

/* --- who keeps it on a flag ---------------------------------------------- */
assert.equal(keepsExperienceOnFlag(actor("monster")), true);
assert.equal(keepsExperienceOnFlag(actor(ANIMAL_TYPE)), true, "an animal has no system field either");
assert.equal(keepsExperienceOnFlag(actor("character")), false);
assert.equal(keepsExperienceOnFlag(actor("acks-extras.vehicle")), false);
assert.equal(keepsExperienceOnFlag(null), false);

/* --- a character goes through the system and writes no flag -------------- */
{
  const handed = [];
  const pc = actor("character", { getExperience: async (v) => handed.push(v) });
  assert.deepEqual(await creditExperience(pc, 240, { source: "deal" }), { via: "system", amount: 240 });
  assert.deepEqual(handed, [240], "the amount reaches the system's call unchanged");
  assert.deepEqual(pc.writes, [], "no flag is written for a character");
  assert.deepEqual(creditedExperience(pc), { total: 0, parts: [] }, "a character's credit is its own field's, not read here");
  const noCall = actor("character");
  assert.equal(await creditExperience(noCall, 50), null, "a character with no system call is not given a flag instead");
  assert.deepEqual(noCall.writes, []);
}

/* --- a monster accumulates on its flag ----------------------------------- */
{
  const ogre = actor("monster");
  assert.deepEqual(await creditExperience(ogre, 150, { source: "deal" }), { via: "flag", amount: 150 });
  assert.deepEqual(await creditExperience(ogre, 90, { source: "deal" }), { via: "flag", amount: 90 });
  assert.deepEqual(await creditExperience(ogre, 10, { source: "gift" }), { via: "flag", amount: 10 });
  assert.deepEqual(ogre.flags[EXPERIENCE_FLAG], { bySource: { deal: 240, gift: 10 } });
  assert.deepEqual(creditedExperience(ogre), { total: 250, parts: [["deal", 240], ["gift", 10]] }, "the total is the sum of the parts, largest first");
  assert.equal(ogre.writes.length, 3);

  const before = ogre.writes.length;
  for (const bad of [0, -20, NaN, undefined]) assert.equal(await creditExperience(ogre, bad, { source: "deal" }), null, `${bad} is no credit`);
  assert.equal(ogre.writes.length, before, "a null credit writes nothing");
}

/* --- an animal is credited the same way; a thing that is neither is refused */
{
  const hound = actor(ANIMAL_TYPE);
  assert.equal((await creditExperience(hound, 12, { source: "deal" })).via, "flag");
  assert.equal(creditedExperience(hound).total, 12);
  const cart = actor("acks-extras.vehicle");
  assert.equal(await creditExperience(cart, 500, { source: "deal" }), null);
  assert.deepEqual(cart.writes, []);
  assert.equal(await creditExperience(null, 5), null);
}

/* --- Deal XP credits a monster henchman's share, hired or hand-made ------- */
{
  const handed = [];
  const pc = (name) => actor("character", {
    name, system: { details: { xp: { share: 100 } } }, getExperience: async (v) => handed.push([name, v]),
  });
  // Hired through the module: a record and a retainer, like `hireMonster` writes.
  const wolf = actor("monster", {
    name: "Pack Wolf", system: { retainer: { enabled: true, category: "henchman" } },
    record: { terms: { xpShare: 0.4, wageBasis: "hd" } },
  });
  // Enrolled by hand on the sheet: a retainer and a share, with no hire behind it.
  const boar = actor("monster", {
    name: "Tusked Boar", system: { retainer: { enabled: true, category: "henchman" } },
    record: { terms: { xpShare: 0.2 } },
  });
  const division = divideXp([pc("Ada"), pc("Bo"), wolf, boar], 2600);
  assert.deepEqual(division.rows.map((r) => [r.name, r.xp, r.onRecord]), [
    ["Ada", 1000, false], ["Bo", 1000, false], ["Pack Wolf", 400, true], ["Tusked Boar", 200, true],
  ], "both monster henchmen take a share and are marked as kept on their own record");
  await awardXp(division);
  assert.deepEqual(handed, [["Ada", 1000], ["Bo", 1000]], "the characters are credited through the system");
  assert.deepEqual(wolf.flags[EXPERIENCE_FLAG], { bySource: { deal: 400 } });
  assert.deepEqual(boar.flags[EXPERIENCE_FLAG], { bySource: { deal: 200 } });

  const again = divideXp([pc("Ada"), wolf], 1400);
  await awardXp(again);
  assert.equal(creditedExperience(wolf).total, 800, "a second deal adds to the first");
}

/* --- the Service panel's row --------------------------------------------- */
{
  const strings = {
    "ACKS-HENCHMEN.service.xpFrom.deal": "Dealt",
    "ACKS-HENCHMEN.service.tip.experience": "has {parts}",
    "ACKS-HENCHMEN.service.tip.experienceNone": "has none",
  };
  // The panel reader pulls in the henchmen engine, which reads these globals at load.
  globalThis.Hooks = { on() {}, once() {}, call() {}, callAll() {} };
  globalThis.foundry = {
    abstract: { DataModel: class {} },
    data: { fields: {} },
    applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {} } },
    utils: {},
  };
  globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
  globalThis.game = {
    settings: { get: () => undefined },
    time: { worldTime: 0 },
    i18n: {
      has: (k) => k in strings,
      localize: (k) => strings[k] ?? k,
      format: (k, d = {}) => (strings[k] ?? k).replace(/\{(\w+)\}/g, (_m, n) => d[n]),
    },
  };
  const { experienceView } = await import("../scripts/henchmen/service-view.mjs");
  const ogre = actor("monster");
  assert.deepEqual(experienceView(ogre), { value: "0", tip: "has none" }, "nothing credited: the row says so, with no figure invented");
  await creditExperience(ogre, 300, { source: "deal" });
  await creditExperience(ogre, 20, { source: "gift" });
  assert.deepEqual(experienceView(ogre), { value: "320", tip: "has Dealt 300 · gift 20" },
    "each source named, adding up to the figure; a source with no name of its own shows as written");
  assert.equal(experienceView(actor("character")), null, "a character's experience is its own sheet's");
  for (const k of ["game", "foundry", "Hooks", "ui"]) delete globalThis[k];
}

console.log("test-experience: OK (pure store, a character's call, a monster's flag, an animal, refusals, Deal XP, the panel row)");
