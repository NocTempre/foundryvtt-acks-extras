/**
 * Offline tests for what the organisation chart asks of the generating feature
 * (scripts/monsters/org-chart-logic.mjs): a leader's badges and which of them a hand
 * chose, the spec a troop change names under the Roll's own key, and the troop options
 * with those off the variant's bands marked. Every label and key in here is invented.
 *
 * Run: node tools/test-org-chart-service.mjs
 */
import assert from "node:assert/strict";
import { badgesOf, respec, troopOptions } from "../scripts/monsters/org-chart-logic.mjs";
import { protoKey } from "../scripts/monsters/organisation-logic.mjs";

const axes = [
  { key: "troop", label: "Troop", options: [{ key: "none", label: "No special type" }, { key: "t1", label: "Type one" }, { key: "t2", label: "Type two" }] },
  { key: "trait", label: "Trait", options: [{ key: "none", label: "None" }, { key: "a", label: "Trait a" }] },
  { key: "gear", label: "Kit", options: [{ key: "k1", label: "Kit one" }, { key: "k2", label: "Kit two" }] },
];
const text = (key, d) => `${key}|${d.axis}|${d.label}`;

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t("a head carries a troop badge top right, a trait badge bottom right and a kit badge bottom left, each from core's icons", () => {
  const badges = badgesOf({ choices: { troop: "t1", trait: "a", gear: ["k1", "k2"] }, axes, text });
  assert.deepEqual(badges.map((b) => [b.axis, b.corner]), [["troop", "tr"], ["trait", "br"], ["gear", "bl"]]);
  assert.ok(badges.every((b) => b.icon.startsWith("icons/svg/")));
  assert.equal(badges[2].label, "Kit one +1", "more than one piece shows as one badge with a count");
});

t("no special type, no trait and no kit draw no badge", () => {
  assert.deepEqual(badgesOf({ choices: { troop: "none", trait: "none", gear: [] }, axes, text }), []);
});

t("a badge is ringed where the row recorded a different troop from the actor's, and not where it agrees or recorded nothing", () => {
  const ring = (rowGen) => badgesOf({ choices: { troop: "t2" }, axes, rowGen, text })[0].byHand;
  assert.equal(ring({ tier: 0, troop: "t1" }), true);
  assert.equal(ring({ tier: 0 }), true, "the roll gave none and the actor has one");
  assert.equal(ring({ tier: 0, troop: "t2" }), false);
  assert.equal(ring({}), false, "a hand-added row recorded nothing to differ from");
  assert.match(badgesOf({ choices: { troop: "t2" }, axes, rowGen: { tier: 0, troop: "t1" }, text })[0].tip, /byHand/);
});

t("a troop change keeps every other part of the spec and takes the Roll's key", () => {
  const spec = { kind: "cell", variant: "alba", role: "c", partKey: "", troop: "t1", trait: "a", grade: "" };
  const out = respec(protoKey(spec), "t2");
  assert.equal(out.spec.troop, "t2");
  assert.equal(out.spec.trait, "a");
  assert.equal(out.key, protoKey({ ...spec, troop: "t2" }), "found again by the key a Roll would give it");
  assert.equal(respec(protoKey(spec), "").spec.troop, "none");
  assert.equal(respec("not json", "t2"), null);
  assert.equal(respec(protoKey({ kind: "entry", uuid: "X" }), "t2"), null, "an entry has no troop");
});

t("troop options mark the ones the variant's bands leave out, and stay selectable", () => {
  const banded = { key: "troop", bandsFrom: { doc: "d", table: "t", by: "variant" }, options: axes[0].options };
  const bandOf = (_axis, option) => (option.key === "t2" ? null : { min: 1, max: 5 });
  const options = troopOptions({ system: { axes: [banded], cells: [] }, variant: "alba", bandOf });
  assert.deepEqual(options.map((o) => [o.key, o.offBands]), [["none", false], ["t1", false], ["t2", true]]);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-org-chart-service: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
