/**
 * Pure-logic regression tests for the influence roller's modifier sources.
 *
 * The roller learns about an ability three ways — its name, an Active Effect it
 * carries, and the abilities effect model — and every one of them can offer the
 * same +1. These tests pin which source speaks for an item on which page,
 * against the REAL modifier tables, so a page that grows or loses a proficiency
 * row is caught here rather than at a table.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { resolveLevelValue } from "../scripts/lib/vocab.mjs";
import { EXTERNAL_MODES, INFLUENCE_MODIFIERS, INFLUENCE_TONE, REACTION_CHANGE_KEY, ROLL_FAMILY } from "../scripts/influence/constants.mjs";
import {
  effectRowsForPage,
  getActsAsPowers,
  getEffectReactionMods,
  getProficiencies,
  getProficiencyItems,
  itemsWithProficiencyRows,
} from "../scripts/influence/actor-data.mjs";
import { getAbilityReactionMods, itemsWithReactionEffects } from "../scripts/influence/ability-effects.mjs";

// The ladder authority is reached through the public global at runtime; the
// tests supply the same implementation the module would find in a live world.
globalThis.acksExtras ??= {};
globalThis.acksExtras.lib = { resolveLevelValue };
globalThis.game ??= { settings: { get: () => true } };

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/** An ability item carrying the abilities effect model (what an import writes). */
const ability = (id, name, effects = [], extra = {}) => ({
  id,
  name,
  type: "ability",
  flags: { "acks-extras": { extras: { effects, ...extra } } },
});

/** A flat reaction bonus in the acks-lib effect vocabulary. */
const reactionMod = (flat, extra = {}) => ({
  type: "modifier",
  target: ROLL_FAMILY.REACTION,
  value: { kind: "flat", flat },
  appliesTo: "self",
  ...extra,
});

/** An item-owned Active Effect in this feature's own convention. */
const reactionEffect = (item, value, flags = {}) => ({
  id: `fx-${item.id}`,
  name: item.name,
  disabled: false,
  parent: { id: item.id, documentName: "Item" },
  changes: [{ key: REACTION_CHANGE_KEY, value }],
  flags: { "acks-extras": { situational: false, ...flags } },
});

const groupsFor = (tone) => INFLUENCE_MODIFIERS[tone].map((g) => ({ group: g.group, mods: g.mods }));

const DIPLOMACY = ability("i-dip", "Diplomacy", [reactionMod(1)]);
const SEDUCTION = ability("i-sed", "Seduction", [reactionMod(1)]);
const PERFORMANCE = ability("i-perf", "Performance (Lute)", [reactionMod(1)]);
const BEAST = ability("i-beast", "Beast Friendship", [reactionMod(2, { vsKinds: ["animal"] })]);
const MYSTIC = ability("i-aura", "Mystic Aura");
const actor = { items: [DIPLOMACY, SEDUCTION, PERFORMANCE, BEAST, MYSTIC] };

t("proficiency detection reports the items behind each name, not just a boolean", () => {
  const items = getProficiencyItems(actor);
  assert.deepEqual(items.diplomacy, ["i-dip"]);
  assert.deepEqual(items.performanceArt, ["i-perf"]);
  assert.deepEqual(items.intimidation, []);
  // The booleans are derived from the same walk, so the two can never disagree.
  assert.deepEqual(getProficiencies(actor).diplomacy, true);
  assert.deepEqual(getProficiencies(actor).intimidation, false);
  // A non-ability item of the same name is not a proficiency.
  assert.deepEqual(getProficiencyItems({ items: [{ id: "x", name: "Diplomacy", type: "item" }] }).diplomacy, []);
});

t("a page claims exactly the proficiencies it renders a row for", () => {
  const dip = itemsWithProficiencyRows(actor, groupsFor(INFLUENCE_TONE.DIPLOMACY));
  assert.deepEqual([...dip].sort(), ["i-aura", "i-dip"]);
  // Performance has a row on Seduction alone; Beast Friendship on no page at
  // all. Claiming either elsewhere would drop a modifier, not deduplicate one.
  assert.equal(dip.has("i-perf"), false);
  assert.equal(dip.has("i-beast"), false);

  const sed = itemsWithProficiencyRows(actor, groupsFor(INFLUENCE_TONE.SEDUCTION));
  assert.deepEqual([...sed].sort(), ["i-aura", "i-perf", "i-sed"]);

  // Intimidation renders no diplomacy row, so the Diplomacy item is unclaimed
  // there and keeps whatever its own effects say.
  const intim = itemsWithProficiencyRows(actor, groupsFor(INFLUENCE_TONE.INTIMIDATION));
  assert.equal(intim.has("i-dip"), false);
  assert.equal(intim.has("i-aura"), true);
});

t("the hiring page claims every proficiency it renders; the other modes claim none", () => {
  // It flattens all four tone rows onto one page, so it claims every one the
  // actor holds — including a tone row left unticked by the exclusive set,
  // which is the row the GM swaps to rather than a bonus that went missing.
  const hiring = itemsWithProficiencyRows(actor, EXTERNAL_MODES.hiring.groups);
  assert.deepEqual([...hiring].sort(), ["i-aura", "i-dip", "i-sed"]);
  for (const mode of ["loyalty", "morale", "obedience"]) {
    assert.equal(itemsWithProficiencyRows(actor, EXTERNAL_MODES[mode].groups).size, 0, mode);
  }
});

t("a proficiency read for something other than the throw claims nothing", () => {
  // The bribe fee reads Bribery to price a bribe; it is not a modifier on the
  // roll, so the Bribery item has not spoken and keeps its own rows.
  const bribes = { items: [ability("i-bribe", "Bribery", [reactionMod(1)])] };
  assert.equal(itemsWithProficiencyRows(bribes, groupsFor(INFLUENCE_TONE.DIPLOMACY)).size, 0);
});

t("both effect sources carry the item they came from", () => {
  const rows = getAbilityReactionMods(actor);
  assert.deepEqual(rows.map((r) => r.itemId).sort(), ["i-beast", "i-dip", "i-perf", "i-sed"]);

  const withEffect = { items: [MYSTIC], appliedEffects: [reactionEffect(MYSTIC, 1)] };
  assert.deepEqual(getEffectReactionMods(withEffect).map((r) => r.itemId), ["i-aura"]);
  // An effect written straight onto the actor rides no item, so it claims none.
  const onActor = { items: [], appliedEffects: [{ ...reactionEffect(MYSTIC, 1), parent: { id: "actor1", documentName: "Actor" } }] };
  assert.equal(getEffectReactionMods(onActor)[0].itemId, null);
  assert.equal(itemsWithReactionEffects(onActor).size, 0);
});

t("an item counts once per page: the proficiency row wins over its own effects", () => {
  const mods = getAbilityReactionMods(actor);
  const dip = effectRowsForPage(mods, {
    family: ROLL_FAMILY.REACTION,
    tone: INFLUENCE_TONE.DIPLOMACY,
    claimed: itemsWithProficiencyRows(actor, groupsFor(INFLUENCE_TONE.DIPLOMACY)),
  });
  // Diplomacy's own +1 is gone — its checkbox is on this page — while the
  // abilities with no row of their own are still offered.
  assert.deepEqual(dip.map((r) => r.itemId).sort(), ["i-beast", "i-perf", "i-sed"]);

  const sed = effectRowsForPage(mods, {
    family: ROLL_FAMILY.REACTION,
    tone: INFLUENCE_TONE.SEDUCTION,
    claimed: itemsWithProficiencyRows(actor, groupsFor(INFLUENCE_TONE.SEDUCTION)),
  });
  assert.deepEqual(sed.map((r) => r.itemId).sort(), ["i-beast", "i-dip"]);
});

t("an Active Effect on a named proficiency is claimed the same way", () => {
  // The escape hatch for homebrew: a hand-authored AE on the Mystic Aura item.
  // It fills the same checkbox, so it must not also add a row to the page.
  const homebrew = { items: [MYSTIC], appliedEffects: [reactionEffect(MYSTIC, 1)] };
  const mods = getEffectReactionMods(homebrew);
  assert.equal(mods.length, 1);
  const rows = effectRowsForPage(mods, {
    family: ROLL_FAMILY.REACTION,
    tone: INFLUENCE_TONE.DIPLOMACY,
    claimed: itemsWithProficiencyRows(homebrew, groupsFor(INFLUENCE_TONE.DIPLOMACY)),
  });
  assert.deepEqual(rows, []);
});

t("the claim is per page, never per roll family", () => {
  const loyal = ability("i-sed2", "Seduction", [
    reactionMod(1),
    { type: "modifier", target: ROLL_FAMILY.LOYALTY, value: { kind: "flat", flat: 1 }, appliesTo: "self" },
  ]);
  const mods = getAbilityReactionMods({ items: [loyal] });
  // The loyalty page renders no proficiency rows, so the same item's loyalty
  // bonus survives there — a claim settles one page, not the ability.
  const rows = effectRowsForPage(mods, {
    family: ROLL_FAMILY.LOYALTY,
    claimed: itemsWithProficiencyRows({ items: [loyal] }, EXTERNAL_MODES.loyalty.groups),
  });
  assert.deepEqual(rows.map((r) => r.family), [ROLL_FAMILY.LOYALTY]);
});

t("a page with no tone offers a tone-scoped row rather than excluding it", () => {
  const toned = ability("i-toned", "Bargaining", [reactionMod(1, { tones: [INFLUENCE_TONE.DIPLOMACY] })]);
  const mods = getAbilityReactionMods({ items: [toned] });
  assert.equal(effectRowsForPage(mods, { family: ROLL_FAMILY.REACTION }).length, 1);
  assert.equal(effectRowsForPage(mods, { family: ROLL_FAMILY.REACTION, tone: INFLUENCE_TONE.DIPLOMACY }).length, 1);
  assert.equal(effectRowsForPage(mods, { family: ROLL_FAMILY.REACTION, tone: INFLUENCE_TONE.SEDUCTION }).length, 0);
});

t("a power standing in for a proficiency is claimed by the box it fills", () => {
  // The replacer shape that hides from a name match: the power is named for
  // itself, declares actsAs on an effect carrying no change of its own, and
  // keeps its number in the abilities model. It ticks the Diplomacy box, so
  // that box is its whole contribution.
  const power = ability("i-voice", "Command of Voice", [reactionMod(1)]);
  const standIn = {
    items: [power],
    appliedEffects: [{
      id: "fx-voice",
      name: "Command of Voice",
      disabled: false,
      parent: { id: power.id, documentName: "Item" },
      changes: [],
      flags: { "acks-extras": { actsAs: "diplomacy", label: "Command of Voice" } },
    }],
  };
  assert.deepEqual(getActsAsPowers(standIn).diplomacy, { label: "Command of Voice", itemId: "i-voice" });

  const dip = itemsWithProficiencyRows(standIn, groupsFor(INFLUENCE_TONE.DIPLOMACY));
  assert.equal(dip.has("i-voice"), true);
  assert.deepEqual(
    effectRowsForPage(getAbilityReactionMods(standIn), {
      family: ROLL_FAMILY.REACTION,
      tone: INFLUENCE_TONE.DIPLOMACY,
      claimed: dip,
    }),
    [],
  );
  // Intimidation renders no diplomacy box for it to fill, so nothing is
  // claimed and the power's own row is offered there.
  const intim = itemsWithProficiencyRows(standIn, groupsFor(INFLUENCE_TONE.INTIMIDATION));
  assert.equal(intim.has("i-voice"), false);
});

t("a stand-in for something outside the core four fills no box, so claims nothing", () => {
  // Only CORE_PROFS are ticked from an actsAs power. One naming anything else
  // contributes nothing through a checkbox, so its own row has to survive.
  const power = ability("i-song", "Song of the Siren", [reactionMod(1)]);
  const odd = {
    items: [power],
    appliedEffects: [{
      id: "fx-song",
      disabled: false,
      parent: { id: power.id, documentName: "Item" },
      changes: [],
      flags: { "acks-extras": { actsAs: "performanceArt", label: "Song of the Siren" } },
    }],
  };
  assert.equal(itemsWithProficiencyRows(odd, groupsFor(INFLUENCE_TONE.SEDUCTION)).has("i-song"), false);
});

t("an effect aimed at somebody else is not a modifier on this roll", () => {
  const foe = ability("i-foe", "Deathly Visage", [reactionMod(-2, { appliesTo: "opponent" })]);
  const mods = getAbilityReactionMods({ items: [foe] });
  assert.equal(mods.length, 1);
  assert.equal(effectRowsForPage(mods, { family: ROLL_FAMILY.REACTION }).length, 0);
});

console.log(`\n${n} tests passed (influence modifier sources)`);
