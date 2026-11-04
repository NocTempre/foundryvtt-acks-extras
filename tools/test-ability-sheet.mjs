/**
 * abilities/ability-sheet.mjs: what an effect row on the Mechanics tab reads
 * as. A row's condition follows the face of the kinds whose face is not built
 * around it, a label's page reference rides with it, and a row scoped to one
 * of the ability's throws names that throw.
 *
 * Every label and figure here is invented. Run: node tools/test-ability-sheet.mjs
 */
import assert from "node:assert/strict";

globalThis.acksExtras = {};
globalThis.game = { i18n: { localize: (k) => k, format: (k, d = {}) => `${k}|${JSON.stringify(d)}` } };
globalThis.fromUuidSync = () => null;
// The sheet module's imports subclass core's data model at load; nothing here constructs one.
globalThis.foundry = {
  abstract: { DataModel: class {} },
  data: { fields: {} },
  utils: {},
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {}, DialogV2: class {} } },
};

const { describeEffect, rollScopeChip } = await import("../scripts/abilities/ability-sheet.mjs");

let pass = 0;
const check = (label, fn) => {
  try {
    fn();
    pass++;
  } catch (err) {
    console.error(`FAIL ${label}`);
    throw err;
  }
};

const V = {
  EFFECT_TYPES: { modifier: { label: "Modifier" }, capability: { label: "Capability" }, sense: { label: "Sense" }, reroll: { label: "Reroll" }, companion: { label: "Companion" }, limitation: { label: "Limitation" }, outcome: { label: "Outcome" } },
  MODIFIER_TARGETS: { reaction: { label: "Reaction" } },
  SENSE_TYPES: { acuteHearing: { label: "Acute Hearing" } },
  SPELL_LIKE_FREQ: { perDay: { label: "Per Day" } },
  REROLL_KEEP: { better: { label: "Keep the Better" } },
  rerollTotal: () => 2,
};
const LABEL = "by method (QQ p.7)";

check("a modifier's condition shows as stored, the cited label included", () => {
  const row = describeEffect({ type: "modifier", target: "reaction", value: { kind: "flat", flat: 1 }, condition: LABEL }, V);
  assert.equal(row.text, `Reaction +1 (${LABEL})`);
  assert.equal(describeEffect({ type: "modifier", target: "reaction", value: { kind: "flat", flat: 1 }, condition: "situational (QQ p.7)" }, V).text, "Reaction +1 (situational (QQ p.7))");
});

check("a capability shows its condition after its face", () => {
  assert.equal(describeEffect({ type: "capability", note: "a remark", condition: "while sworn" }, V).text, "a remark (while sworn)");
  assert.equal(describeEffect({ type: "capability", frequency: "perDay", condition: "while sworn" }, V).text, "Per Day (while sworn)");
  assert.equal(describeEffect({ type: "capability" }, V).text, "see description", "no condition adds nothing");
});

check("a sense, a reroll and a companion show their condition", () => {
  assert.equal(describeEffect({ type: "sense", sense: "acuteHearing", range: 30, condition: "by speed" }, V).text, "Acute Hearing 30' (by speed)");
  assert.equal(describeEffect({ type: "reroll", forWhat: "Tumbling", keep: "better", condition: "for an ally" }, V).text, "Tumbling 2× — Keep the Better (for an ally)");
  const companion = describeEffect({ type: "companion", note: "followers", condition: "with a prerequisite" }, V).text;
  assert.ok(companion.startsWith("followers ") && companion.endsWith("(with a prerequisite)"), companion);
});

check("a limitation shows its restriction, then its condition; a bare condition stands alone", () => {
  assert.equal(describeEffect({ type: "limitation", restriction: "a retry limit (QQ p.7)", condition: LABEL }, V).text, `a retry limit (QQ p.7) (${LABEL})`);
  assert.equal(describeEffect({ type: "limitation", condition: "armor" }, V).text, "armor");
});

check("an outcome shows its consequence", () => {
  const row = describeEffect({ type: "outcome", trigger: "naturalBand", naturalMax: 2, consequence: "a mishap (QQ p.7)" }, V);
  assert.equal(row.text, "natural 1–2: a mishap (QQ p.7)");
});

check("a row scoped to a throw names it by the throw's label, or by its key", () => {
  const rolls = [{ key: "quick", label: "quickly" }, { key: "slow", label: "slowly" }];
  const chip = rollScopeChip({ type: "modifier", appliesToRoll: "slow" }, rolls);
  assert.equal(chip.label, `ACKS-ABILITIES.mech.appliesToRoll|${JSON.stringify({ roll: "slowly" })}`);
  assert.equal(chip.tip, `ACKS-ABILITIES.mech.appliesToRollTip|${JSON.stringify({ roll: "slowly" })}`);
  assert.equal(rollScopeChip({ appliesToRoll: "gone" }, rolls).label, `ACKS-ABILITIES.mech.appliesToRoll|${JSON.stringify({ roll: "gone" })}`);
  assert.equal(rollScopeChip({ type: "modifier" }, rolls), null);
});

console.log(`test-ability-sheet: ${pass} passed`);
