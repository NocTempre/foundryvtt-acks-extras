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

const { describeEffect, rollScopeChip, capabilityLabel, nameForSelections } = await import("../scripts/abilities/ability-sheet.mjs");
const { default: AbilityExtras, selectionsOf, storedSelections } = await import("../scripts/abilities/ability-extras.mjs");
const { registerSelectionVocab, selectionVocabFor } = await import("../scripts/lib/vocab.mjs");

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
  EFFECT_MODES: { add: { label: "Add" }, replace: { label: "Replace" } },
  EFFECT_TYPES: { modifies: { label: "Modifies" }, requires: { label: "Requires" }, modifier: { label: "Modifier" }, capability: { label: "Capability" }, sense: { label: "Sense" }, reroll: { label: "Reroll" }, companion: { label: "Companion" }, limitation: { label: "Limitation" }, outcome: { label: "Outcome" } },
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

check("a printed frequency shows the words the importer read; a structural one shows its label", () => {
  assert.equal(describeEffect({ type: "spellLike", spell: "glimmer", frequency: "printedFreq1", frequencyText: "every so often" }, V).text, "glimmer — every so often");
  assert.equal(describeEffect({ type: "capability", frequency: "printedFreq2", frequencyText: "when the moon is up" }, V).text, "when the moon is up");
  assert.equal(describeEffect({ type: "spellLike", spell: "glimmer", frequency: "perDay", frequencyText: "ignored" }, V).text, "glimmer — Per Day", "a stored phrase never overrides a structural member");
  assert.equal(describeEffect({ type: "spellLike", spell: "glimmer", frequency: "printedFreq1" }, V).text, "glimmer — printedFreq1", "no phrase falls back to the label");
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

check("a kind with no face of its own shows its note, then its condition", () => {
  assert.equal(describeEffect({ type: "immunity", note: "a lure", condition: "while raging" }, V).text, "a lure (while raging)");
  assert.equal(describeEffect({ type: "immunity", condition: "while raging" }, V).text, "while raging", "a bare condition stands alone");
  assert.equal(describeEffect({ type: "immunity" }, V).text, "—");
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

// --- capability tokens -------------------------------------------------------

/** A library item as the sheet reads one: a definition id, and extras behind getFlag. */
const libraryItem = (name, id, extras = {}) => ({
  name,
  flags: { "acks-extras": { cookbook: { id } } },
  getFlag(scope, key) {
    return key === "extras" ? extras : undefined;
  },
});
globalThis.game.items = [
  libraryItem("Invented Alias", "def.prof.inventedSight", { aliasOf: "def.prof.inventedSight" }),
  libraryItem("Invented Sight", "def.prof.inventedSight"),
];

check("a capability ref reads as the library ability that provides it, an alias skipped", () => {
  assert.equal(capabilityLabel("kw:inventedsight"), "Invented Sight");
  assert.equal(describeEffect({ type: "requires", refs: ["kw:inventedsight"] }, V).text, "Invented Sight");
  assert.equal(describeEffect({ type: "requires", ref: "kw:inventedsight" }, V).text, "Invented Sight");
});

check("a capability nothing provides reads as its bare word, never the kw: token", () => {
  assert.equal(capabilityLabel("kw:inventedsmell"), "inventedsmell");
  assert.equal(describeEffect({ type: "requires", refs: ["kw:inventedsmell"] }, V).text, "inventedsmell");
});

check("a modifies row with only a ref reads as the ref, no target, figure or mode", () => {
  assert.equal(describeEffect({ type: "modifies", ref: "kw:inventedsight" }, V).text, "Invented Sight");
  assert.equal(describeEffect({ type: "modifies", refs: ["kw:inventedsight", "kw:inventedsmell"] }, V).text, "Invented Sight, inventedsmell");
});

check("a modifies row prints the target, the figure and the mode it has, each alone", () => {
  const flat = { kind: "flat", flat: 2 };
  assert.equal(describeEffect({ type: "modifies", ref: "kw:inventedsight", target: "reaction", value: flat, mode: "add" }, V).text, "Invented Sight: Reaction +2 (Add)");
  assert.equal(describeEffect({ type: "modifies", ref: "kw:inventedsight", value: flat }, V).text, "Invented Sight: +2");
  assert.equal(describeEffect({ type: "modifies", ref: "kw:inventedsight", target: "reaction" }, V).text, "Invented Sight: Reaction");
  assert.equal(describeEffect({ type: "modifies", ref: "kw:inventedsight", mode: "replace" }, V).text, "Invented Sight (Replace)");
});

// --- picks held by a name ----------------------------------------------------

// The schema read is the one piece of core in the way: it returns the stored flag.
AbilityExtras.fromItem = (item) => ({
  selections: item.flags?.["acks-extras"]?.extras?.selections ?? [],
  category: item.flags?.["acks-extras"]?.extras?.category ?? "",
});
registerSelectionVocab("inventedtrade", () => ({
  alpha: { label: "Alpha Kind" },
  beta: { label: "Beta Kind", aliases: ["bee"] },
  all: { label: "Everything" },
}));
/** A frozen ability copy, so a write to it throws instead of passing unseen. */
const trade = (name, selections = []) => Object.freeze({ name, flags: Object.freeze({ "acks-extras": { extras: { selections: Object.freeze([...selections]) } } }) });

check("a name's trailing parenthetical is no pick unless the vocabulary names it", () => {
  assert.deepEqual(selectionsOf(trade("Invented Trade (variant words)")), []);
  assert.deepEqual(selectionsOf(trade("Invented Trade (small tools)")), [], "a loose substring of a key claims nothing");
  assert.deepEqual(storedSelections(trade("Invented Trade (variant words)")), []);
});

check("a parenthetical that resolves is read as a pick, and nothing is written", () => {
  assert.deepEqual(selectionsOf(trade("Invented Trade (Alpha Kind)")), ["Alpha Kind"]);
  assert.deepEqual(selectionsOf(trade("Invented Trade (Alpha Kind, bee, other words)")), ["Alpha Kind", "bee"]);
  assert.deepEqual(storedSelections(trade("Invented Trade (Alpha Kind)")), [], "the sheet's own read never takes it from the name");
});

check("stored picks win over the name", () => {
  assert.deepEqual(selectionsOf(trade("Invented Trade (Alpha Kind)", ["beta"])), ["beta"]);
});

check("an ability with no vocabulary has no named picks", () => {
  assert.equal(selectionVocabFor({ name: "Uninvented Craft" }, "proficiency"), null);
  assert.deepEqual(selectionsOf(trade("Uninvented Craft (Alpha Kind)")), []);
});

check("a save rewrites the name only when picks are or were stored", () => {
  const vocab = selectionVocabFor({ name: "Invented Trade" }, "proficiency");
  assert.equal(nameForSelections("Invented Trade (variant words)", [], [], vocab), null, "no picks before or after: the name stands");
  assert.equal(nameForSelections("Invented Trade (variant words)", [], ["alpha"], vocab), "Invented Trade (Alpha Kind)");
  assert.equal(nameForSelections("Invented Trade (Alpha Kind)", ["alpha"], [], vocab), "Invented Trade", "clearing stored picks removes their suffix");
});

console.log(`test-ability-sheet: ${pass} passed`);
