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
import { ACTOR_TYPE, resolveLevelValue } from "../scripts/lib/vocab.mjs";
import fs from "node:fs";
import { AGING_PAGE, BEWITCH_PAGE, EXTERNAL_MODES, INFLUENCE_DOC, INFLUENCE_MODIFIERS, INFLUENCE_RESULTS, INFLUENCE_TONE, REACTION_CHANGE_KEY, ROLL_FAMILY, TONE_PAGES, externalRows } from "../scripts/influence/constants.mjs";
import {
  ageCategoryIndex,
  bewitchMark,
  bribeCrimeMark,
  computeDefaults,
  effectRowsForPage,
  getActsAsPowers,
  getEffectReactionMods,
  getProficiencies,
  getProficiencyItems,
  itemsWithProficiencyRows,
  moraleRatingOf,
  offeredEffectRows,
  resolveHeldRows,
} from "../scripts/influence/actor-data.mjs";
import { MORALE_DOC, attitudeFigure, figureOrigin, modeRows, printedBands, printedFigure, printedLabel, toneBands, toneRows } from "../scripts/influence/printed.mjs";
import { conditionEntries, conditionRows } from "../scripts/influence/condition-rows.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";
import { getAbilityReactionMods, itemsWithReactionEffects } from "../scripts/influence/ability-effects.mjs";
import { inferRace, kindOf } from "../scripts/influence/racial.mjs";

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

/** A flat reaction bonus in the lib effect vocabulary. */
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

t("a roller keeps a pushed row that adds something, and a zero row only when it is a note", () => {
  const rows = externalRows([
    { label: "Old Quarter (district)", value: -1 },
    { label: "a quarter that prices nothing", value: 0 },
    { label: "Legal authority here: Watch", value: 0, note: true },
    { label: "a figure wearing a note's mark", value: 2, note: true },
    { value: "3" },
    null,
  ]);
  assert.deepEqual(rows, [
    { label: "Old Quarter (district)", value: -1, note: false },
    { label: "Legal authority here: Watch", value: 0, note: true },
    { label: "a figure wearing a note's mark", value: 2, note: false },
    { label: "external", value: 3, note: false },
  ]);
  assert.deepEqual(externalRows(undefined), [], "no list is no rows");
  // What a player's dialog forwards to the Judge's is this same shape, and it
  // must survive the second pass whole.
  assert.deepEqual(externalRows(rows), rows);
});

/* --- printed morale pages: figures from the import, never from this repo --- */

/** Every row a page declares, across its groups. */
const rowsOf = (mode) => modeRows(mode).flatMap((g) => g.mods);
const rowOf = (mode, key) => rowsOf(mode).find((m) => m.key === key);

t("a morale page ships its structure and no figure", () => {
  for (const id of ["morale", "obedience"]) {
    const mode = EXTERNAL_MODES[id];
    assert.equal(mode.bands, undefined, `${id}: no result edges`);
    assert.ok(mode.printed && mode.cite && mode.bandKeys.length, `${id}: names its page`);
    for (const mod of mode.groups.flatMap((g) => g.mods)) {
      assert.equal(mod.value, undefined, `${id}.${mod.key}: no figure`);
      assert.equal(mod.options, undefined, `${id}.${mod.key}: no option table`);
    }
  }
});

t("an unread page offers typed fields and reads no result column", () => {
  resetTables();
  for (const id of ["morale", "obedience"]) {
    const mode = EXTERNAL_MODES[id];
    assert.equal(printedBands(mode.printed, mode.bandKeys), null, id);
    for (const declared of mode.groups.flatMap((g) => g.mods)) {
      if (declared.type !== "ladder" && declared.type !== "printed") continue;
      assert.deepEqual(rowOf(mode, declared.key), { key: declared.key, label: declared.label, type: "signed", unread: true }, declared.key);
    }
  }
});

// Invented figures and wording throughout: what is pinned is the reading.
const INVENTED = {
  id: MORALE_DOC,
  tables: {
    monsterMorale: {
      bands: [{ min: null, max: 4 }, { min: 5, max: 6 }, { min: 7, max: 7 }, { min: 8, max: 13 }, { min: 14, max: null }],
      hpLost1: -3,
      hpLost1Label: "Some of it bled",
      hpLost2: -3,
      outnumber2: 9,
      outnumber2Label: "Far more of them",
      noRetreat: 7,
      noRetreatLabel: "Nowhere left to go",
    },
    hirelingObedience: {
      bands: [{ min: null, max: 1 }, { min: 2, max: 9 }],
      company1: 4,
      company2: 0,
      company3: -4,
      customary: 0,
    },
  },
};

t("a read ladder is a choice of the page's rungs, stored by option", () => {
  resetTables();
  registerTable(INVENTED, { priority: PRIORITY.WORLD });
  const hp = rowOf(EXTERNAL_MODES.morale, "creatureHp");
  assert.equal(hp.type, "select");
  assert.equal(hp.byIndex, true);
  // Two rungs printing one figure stay two options; the blank leads.
  assert.deepEqual(hp.options.map((o) => [o.value, o.figure]), [[0, 0], [1, -3], [2, -3]]);
  assert.equal(hp.options[1].printedLabel, "Some of it bled");
  assert.equal(hp.options[2].printedLabel, null);

  // A rung the page did not yield is left out; the ones it did keep page order.
  const out = rowOf(EXTERNAL_MODES.morale, "outnumber");
  assert.deepEqual(out.options.map((o) => [o.value, o.figure]), [[0, 0], [1, 9]]);

  // No rung of this ladder was read, so the Judge types it.
  assert.equal(rowOf(EXTERNAL_MODES.morale, "groupLosses").unread, true);

  // A rung printing zero is a rung, not the blank.
  const company = rowOf(EXTERNAL_MODES.obedience, "company");
  assert.deepEqual(company.options.map((o) => o.figure), [0, 4, 0, -4]);
});

t("a read figure is a tick worth what the page prints, zero included", () => {
  const cornered = rowOf(EXTERNAL_MODES.morale, "cornered");
  assert.deepEqual(
    { type: cornered.type, value: cornered.value, printedLabel: cornered.printedLabel, showFigure: cornered.showFigure },
    { type: "check", value: 7, printedLabel: "Nowhere left to go", showFigure: true },
  );
  assert.equal(rowOf(EXTERNAL_MODES.obedience, "customary").value, 0);
  assert.equal(rowOf(EXTERNAL_MODES.obedience, "casualties").unread, true);
  assert.equal(printedFigure("monsterMorale", "noSuchKey"), null);
  assert.equal(printedLabel("monsterMorale", "hpLost2"), null);
});

t("a result column is the page's edges under the mode's rung names", () => {
  const morale = EXTERNAL_MODES.morale;
  assert.deepEqual(printedBands(morale.printed, morale.bandKeys), [
    { max: 4, key: "frightenedRetreat" },
    { min: 5, max: 6, key: "faltering" },
    { min: 7, max: 7, key: "fightOn" },
    { min: 8, max: 13, key: "advancePursue" },
    { min: 14, key: "victoryOrDeath" },
  ]);
  // Two rungs where the page declares three is some other table.
  const obedience = EXTERNAL_MODES.obedience;
  assert.equal(printedBands(obedience.printed, obedience.bandKeys), null);
  resetTables();
});

/* --- the hiring page: the same reading, from the `influence` document --- */

t("the hiring page ships its structure and no figure", () => {
  const mode = EXTERNAL_MODES.hiring;
  assert.equal(mode.bands, undefined, "no result edges");
  assert.equal(mode.printedDoc, INFLUENCE_DOC);
  assert.ok(mode.printed && mode.cite && mode.bandKeys.length, "names its page");
  for (const id of ["hiring", "marketAssessment"]) {
    for (const mod of EXTERNAL_MODES[id].groups.flatMap((g) => g.mods)) {
      assert.equal(mod.value, undefined, `${id}.${mod.key}: no figure`);
      assert.equal(mod.factor, undefined, `${id}.${mod.key}: no factor`);
    }
  }
});

t("an unread hiring page types its penalties and reads no result column", () => {
  resetTables();
  const mode = EXTERNAL_MODES.hiring;
  assert.equal(printedBands(mode.printed, mode.bandKeys, mode.printedDoc), null);
  for (const key of ["previousRefusals", "slander"]) {
    const declared = mode.groups.flatMap((g) => g.mods).find((m) => m.key === key);
    assert.deepEqual(rowOf(mode, key), { key, label: declared.label, type: "signed", unread: true }, key);
  }
});

// Invented edges and figures: what is pinned is the reading.
const INVENTED_HIRING = {
  id: INFLUENCE_DOC,
  tables: {
    hiringOffer: {
      bands: [{ min: null, max: 3 }, { min: 4, max: 4 }, { min: 5, max: 10 }, { min: 11, max: 15 }, { min: 16, max: null }],
      refusalPenalty: -7,
      slanderPenalty: -3,
    },
  },
};

t("a read hiring page owes each count the page's figure, under the mode's rung names", () => {
  resetTables();
  registerTable(INVENTED_HIRING, { priority: PRIORITY.WORLD });
  const mode = EXTERNAL_MODES.hiring;
  const refusals = rowOf(mode, "previousRefusals");
  assert.deepEqual(
    { type: refusals.type, factor: refusals.factor, auto: refusals.auto, showFigure: refusals.showFigure },
    { type: "factor", factor: -7, auto: "ctx:previousRefusals", showFigure: true },
  );
  assert.equal(rowOf(mode, "slander").factor, -3);
  assert.deepEqual(printedBands(mode.printed, mode.bandKeys, mode.printedDoc), [
    { max: 3, key: "refuseSlander" },
    { min: 4, max: 4, key: "refuse" },
    { min: 5, max: 10, key: "tryAgain" },
    { min: 11, max: 15, key: "accept" },
    { min: 16, key: "acceptElan" },
  ]);
  // The documents are apart: a hiring import says nothing of the morale pages.
  assert.equal(printedBands(EXTERNAL_MODES.morale.printed, EXTERNAL_MODES.morale.bandKeys), null);
  resetTables();
  registerTable({ id: INFLUENCE_DOC, tables: { hiringOffer: { ...INVENTED_HIRING.tables.hiringOffer, bands: INVENTED_HIRING.tables.hiringOffer.bands.slice(1) } } }, { priority: PRIORITY.WORLD });
  assert.equal(printedBands(mode.printed, mode.bandKeys, mode.printedDoc), null, "four rungs where the page names five is some other table");
  resetTables();
});

/* --- the loyalty page: one printed figure on a page whose result column is not --- */

t("the loyalty and irrefusable pages ship their structure and no figure or edge", () => {
  for (const id of ["loyalty", "irrefusableOffer"]) {
    const mode = EXTERNAL_MODES[id];
    assert.equal(mode.bands, undefined, `${id}: no result edges`);
    assert.equal(mode.printedDoc, INFLUENCE_DOC, `${id}: its table is of the influence document`);
    assert.ok(mode.printed && mode.cite && mode.bandKeys.length && mode.postsWithoutBands, `${id}: names its page and posts without a result`);
    for (const mod of mode.groups.flatMap((g) => g.mods)) {
      assert.equal(mod.value, undefined, `${id}.${mod.key}: no figure`);
    }
  }
  assert.equal(EXTERNAL_MODES.loyalty.printed, "hirelingLoyalty");
});

t("an unread irrefusable offer types its alignment figure by hand and names no result", () => {
  resetTables();
  const mode = EXTERNAL_MODES.irrefusableOffer;
  const declared = mode.groups.flatMap((g) => g.mods).find((m) => m.key === "oppositeAlignment");
  assert.deepEqual(rowOf(mode, "oppositeAlignment"), { key: "oppositeAlignment", label: declared.label, type: "signed", unread: true });
  assert.equal(printedBands(mode.printed, mode.bandKeys, mode.printedDoc), null);
  assert.equal(printedBands(EXTERNAL_MODES.loyalty.printed, EXTERNAL_MODES.loyalty.bandKeys, INFLUENCE_DOC), null);
});

t("a read irrefusable offer is worth the page's figure and takes the page's edges", () => {
  resetTables();
  const bands = [{ min: null, max: 3 }, { min: 4, max: 5 }, { min: 6, max: 9 }, { min: 10, max: 14 }, { min: 15, max: null }];
  registerTable({ id: INFLUENCE_DOC, tables: { irrefusableOffer: { oppositeAlignment: -7, bands }, hirelingLoyalty: { bands } } }, { priority: PRIORITY.WORLD });
  const mode = EXTERNAL_MODES.irrefusableOffer;
  const row = rowOf(mode, "oppositeAlignment");
  assert.deepEqual({ type: row.type, value: row.value, showFigure: row.showFigure }, { type: "check", value: -7, showFigure: true });
  assert.deepEqual(printedBands(mode.printed, mode.bandKeys, mode.printedDoc).map((b) => b.key), ["betrayal", "escape", "hesitate", "accept", "acceptElan"]);
  assert.deepEqual(printedBands("hirelingLoyalty", EXTERNAL_MODES.loyalty.bandKeys, INFLUENCE_DOC).map((b) => b.key), ["hostility", "resignation", "grudging", "loyal", "fanatic"]);
  resetTables();
});

t("the loyalty page names its one printed figure's table on the row and ships no figure for it", () => {
  const mode = EXTERNAL_MODES.loyalty;
  const declared = mode.groups.flatMap((g) => g.mods).find((m) => m.key === "apparentLevelDiff");
  assert.deepEqual(
    { type: declared.type, printed: declared.printed, printedDoc: declared.printedDoc, factor: declared.factor, auto: declared.auto },
    { type: "printedFactor", printed: "apparentLevel", printedDoc: INFLUENCE_DOC, factor: undefined, auto: "ctx:apparentLevelDiff" },
  );
});

t("an unread loyalty figure is typed by hand and leaves the page's other rows alone", () => {
  resetTables();
  const mode = EXTERNAL_MODES.loyalty;
  const declared = mode.groups.flatMap((g) => g.mods).find((m) => m.key === "apparentLevelDiff");
  assert.deepEqual(rowOf(mode, "apparentLevelDiff"), { key: "apparentLevelDiff", label: declared.label, type: "signed", unread: true });
  assert.equal(rowOf(mode, "effectiveLoyalty").auto, "ctx:effectiveLoyalty", "a row with no printed figure passes through");
  // A hiring import is another table of the same document.
  registerTable(INVENTED_HIRING, { priority: PRIORITY.WORLD });
  assert.equal(rowOf(mode, "apparentLevelDiff").unread, true);
  resetTables();
});

t("a read loyalty figure is owed once per level counted", () => {
  resetTables();
  registerTable({ id: INFLUENCE_DOC, tables: { apparentLevel: { perLevel: -5 } } }, { priority: PRIORITY.WORLD });
  const row = rowOf(EXTERNAL_MODES.loyalty, "apparentLevelDiff");
  assert.deepEqual(
    { type: row.type, factor: row.factor, auto: row.auto, showFigure: row.showFigure },
    { type: "factor", factor: -5, auto: "ctx:apparentLevelDiff", showFigure: true },
  );
  resetTables();
});

t("a row naming its own table reads it, beside rows reading the mode's", () => {
  resetTables();
  registerTable({ id: MORALE_DOC, tables: { pageTable: { figure: 2 } } }, { priority: PRIORITY.WORLD });
  registerTable({ id: INFLUENCE_DOC, tables: { rowTable: { figure: -4 } } }, { priority: PRIORITY.WORLD });
  const mode = {
    printed: "pageTable",
    groups: [{ group: "g", mods: [
      { key: "fromPage", type: "printed", figure: "figure", label: "a" },
      { key: "fromRow", type: "printedFactor", printed: "rowTable", printedDoc: INFLUENCE_DOC, figure: "figure", label: "b" },
    ] }],
  };
  assert.equal(rowOf(mode, "fromPage").value, 2, "the mode's table, in the morale document");
  assert.equal(rowOf(mode, "fromRow").factor, -4, "the row's own table, in its own document");
  resetTables();
});

/** A roller's effect rows as the hiring page reads them: Active Effects, then the abilities model. */
const rollerRows = (roller) => [...getEffectReactionMods(roller), ...getAbilityReactionMods(roller, itemsWithReactionEffects(roller))];
const heldRow = (held, key) => held.groups.flatMap((g) => g.mods).find((m) => m.key === key);

t("a held box is drawn only for a roller who holds it, worth what that roller's item carries", () => {
  const groups = modeRows(EXTERNAL_MODES.hiring);
  const nobody = { items: [], appliedEffects: [] };
  const none = resolveHeldRows(groups, nobody, [], ROLL_FAMILY.REACTION);
  assert.equal(heldRow(none, "diplomacyProf"), undefined, "nobody holds Diplomacy, so no box");
  assert.equal(heldRow(none, "charisma").type, "signed", "a row that is not held passes through");
  assert.equal(none.claimed.size, 0);

  const talker = { items: [ability("h-dip", "Diplomacy", [reactionMod(4)]), ability("h-aura", "Mystic Aura")], appliedEffects: [] };
  const held = resolveHeldRows(groups, talker, rollerRows(talker), ROLL_FAMILY.REACTION);
  assert.deepEqual(
    (({ type, value, showFigure, exclusive, auto, heldFrom }) => ({ type, value, showFigure, exclusive, auto, heldFrom }))(heldRow(held, "diplomacyProf")),
    { type: "check", value: 4, showFigure: true, exclusive: "toneProf", auto: "prof:diplomacy", heldFrom: "diplomacy" },
  );
  assert.deepEqual(heldRow(held, "mysticAura"), { key: "mysticAura", label: "ACKS-INFLUENCE.mod.held.mysticAura", heldFrom: "mysticAura", type: "signed", unvalued: true });
  assert.equal(heldRow(held, "seductionProf"), undefined);
  assert.deepEqual([...held.claimed].sort(), ["h-aura", "h-dip"]);
  // A drawn box claims its item, so the item's own row is not offered again.
  assert.deepEqual([...itemsWithProficiencyRows(talker, held.groups)].sort(), ["h-aura", "h-dip"]);
});

t("a held box takes the item's Active Effect first, its own family only, and never pre-ticks a draft", () => {
  const groups = modeRows(EXTERNAL_MODES.hiring);
  const dip = ability("h-dip", "Diplomacy", [reactionMod(4)]);
  const judged = { items: [dip], appliedEffects: [reactionEffect(dip, 9)] };
  assert.equal(heldRow(resolveHeldRows(groups, judged, rollerRows(judged), ROLL_FAMILY.REACTION), "diplomacyProf").value, 9);

  const loyalOnly = { items: [ability("h-dip", "Diplomacy", [{ type: "modifier", target: ROLL_FAMILY.LOYALTY, value: { kind: "flat", flat: 5 }, appliesTo: "self" }])], appliedEffects: [] };
  assert.equal(heldRow(resolveHeldRows(groups, loyalOnly, rollerRows(loyalOnly), ROLL_FAMILY.REACTION), "diplomacyProf").unvalued, true, "a loyalty figure is not a hiring figure");

  const draft = { items: [ability("h-dip", "Diplomacy", [reactionMod(4)], { unaudited: true })], appliedEffects: [] };
  const row = heldRow(resolveHeldRows(groups, draft, rollerRows(draft), ROLL_FAMILY.REACTION), "diplomacyProf");
  assert.deepEqual([row.value, row.unaudited, row.default, row.auto], [4, true, false, undefined]);
  // An offered row carries its two flags apart; unaudited alone holds the tick back.
  const dipOnly = { items: [ability("h-dip", "Diplomacy", [reactionMod(4)])], appliedEffects: [] };
  const offeredDraft = offeredEffectRows([{ id: "fx-d", label: "A draft charm", value: 2, unaudited: true, itemId: "h-dip" }], ROLL_FAMILY.REACTION);
  const fromOffer = heldRow(resolveHeldRows(groups, dipOnly, [...offeredDraft, ...rollerRows(dipOnly)], ROLL_FAMILY.REACTION), "diplomacyProf");
  assert.deepEqual([fromOffer.value, fromOffer.unaudited, fromOffer.default, fromOffer.auto], [2, true, false, undefined], "an unaudited row is never pre-ticked, situational or not");

  const conditioned = { items: [ability("h-int", "Intimidation", [reactionMod(3, { condition: "a lesser foe" })])], appliedEffects: [] };
  const cond = heldRow(resolveHeldRows(groups, conditioned, rollerRows(conditioned), ROLL_FAMILY.REACTION), "intimidationProf");
  assert.deepEqual([cond.value, cond.unaudited, cond.default, cond.auto], [3, undefined, false, undefined], "a figure with a condition is offered, never pre-ticked");
});

t("an opener's offered rows join the page's own, and speak for their item", () => {
  assert.deepEqual(offeredEffectRows(undefined, ROLL_FAMILY.REACTION), []);
  const offered = offeredEffectRows(
    [
      { id: "fx-1", label: "A hiring charm", value: 2, situational: true, itemId: "h-dip" },
      { id: "fx-2", label: "Worth nothing", value: 0 },
      { label: "On the actor", value: -1 },
    ],
    ROLL_FAMILY.MORALE,
  );
  assert.deepEqual(
    offered.map(({ id, itemId, value, family, situational, source }) => [id, itemId, value, family, situational, source]),
    [
      ["offer:fx-1", "h-dip", 2, ROLL_FAMILY.MORALE, true, "offered"],
      ["offer:2", null, -1, ROLL_FAMILY.MORALE, false, "offered"],
    ],
  );
  // An offered row is its item's Active Effect, so a held box reads it first.
  const talker = { items: [ability("h-dip", "Diplomacy", [reactionMod(4)])], appliedEffects: [] };
  const mine = offeredEffectRows([{ id: "fx-1", label: "A hiring charm", value: 2, itemId: "h-dip" }], ROLL_FAMILY.REACTION);
  const held = resolveHeldRows(modeRows(EXTERNAL_MODES.hiring), talker, [...mine, ...rollerRows(talker)], ROLL_FAMILY.REACTION);
  assert.equal(heldRow(held, "diplomacyProf").value, 2);
});

t("a note about one item keeps its id; a figure row does not need one", () => {
  assert.deepEqual(
    externalRows([
      { label: "A power with no value", note: true, itemId: "h-voice" },
      { label: "A quarter", value: -2, itemId: "h-any" },
    ]),
    [
      { label: "A power with no value", value: 0, note: true, itemId: "h-voice" },
      { label: "A quarter", value: -2, note: false },
    ],
  );
});

t("a group rolls on its command morale, with its one stack's base when it has one", () => {
  const group = (stacks) => ({
    system: { stacks, commandMorale: 2, unitMoraleOf: (stack) => stack.baseMorale + 2 },
  });
  assert.equal(moraleRatingOf(group([{ baseMorale: -1 }])), 1);
  assert.equal(moraleRatingOf(group([{ baseMorale: -1 }, { baseMorale: 1 }])), 2);
  assert.equal(moraleRatingOf({ system: { details: { morale: -3 } } }), -3);
  assert.equal(moraleRatingOf(null), 0);
});

/* --- conditions on a page: named rows, and notes for what the roll does not take --- */

t("only a page that names its roll takes conditions", () => {
  assert.equal(EXTERNAL_MODES.morale.conditions, "morale");
  for (const id of Object.keys(EXTERNAL_MODES)) {
    if (id !== "morale") assert.equal(EXTERNAL_MODES[id].conditions, undefined, id);
  }
  assert.deepEqual(conditionEntries(null, { statuses: [] }), []);
  assert.deepEqual(conditionEntries("morale", null), []);
});

t("a condition's figure is a row, and what the roll leaves out is a note", () => {
  // A stand-in for the conditions model's answer: the reading is what is pinned.
  const entries = [
    { kind: "exempt", condition: "aa" },
    { kind: "applied", condition: "bb", value: 3 },
    { kind: "pending", condition: "cc", value: -2, when: "fear" },
    { kind: "unpriced", condition: "dd" },
  ];
  const rows = conditionRows(entries, (e) => `${e.kind}:${e.condition}`);
  assert.deepEqual(rows, [
    { label: "exempt:aa", note: true },
    { label: "applied:bb", value: 3 },
    { label: "pending:cc", note: true },
    { label: "unpriced:dd", note: true },
  ]);
  // The roller keeps the figure in its total and draws the notes beside it.
  const kept = externalRows(rows);
  assert.equal(kept.reduce((sum, r) => sum + r.value, 0), 3);
  assert.equal(kept.filter((r) => r.note).length, 3);
});

t("a creature with no conditions adds no row", () => {
  resetTables();
  assert.deepEqual(conditionEntries("morale", { statuses: [] }), []);
});

// The ladder is invented; what is pinned is that the bribe reads the henchmen
// wage ladder, says null where none is imported, and holds a level to the
// ladder's own rungs.
{
  const libTables = await import("../scripts/lib/tables.mjs");
  const { henchmanMonthlyWage } = await import("../scripts/influence/constants.mjs");
  const saved = globalThis.acksExtras.lib.tables;
  globalThis.acksExtras.lib.tables = libTables;
  try {
    t("a bribe's wage is the imported henchman wage ladder, or none", () => {
      resetTables();
      assert.equal(henchmanMonthlyWage(2), null, "no ladder imported: nothing prices the bribe");
      registerTable({ id: "wages", tables: { henchmanWageByLevel: { byLevel: { 0: 3, 1: 5, 2: 0, 3: 11 } } } }, { priority: PRIORITY.WORLD });
      assert.equal(henchmanMonthlyWage(1), 5);
      assert.equal(henchmanMonthlyWage(2), 0, "an imported 0 is a wage, not an absence");
      assert.equal(henchmanMonthlyWage(1.9), 5, "hit dice count whole");
      assert.equal(henchmanMonthlyWage(9), 11, "past the ladder's top rung, the top rung");
      assert.equal(henchmanMonthlyWage(-2), 3, "below its lowest, the lowest");
      resetTables();
    });
  } finally {
    globalThis.acksExtras.lib.tables = saved;
  }
}

/* --- the tone pages: structure ships, figures arrive from the import --- */

/** Every row a tone page declares, with its tone. */
const toneRowsDeclared = () => Object.entries(INFLUENCE_MODIFIERS).flatMap(([tone, groups]) => groups.flatMap((g) => g.mods.map((mod) => ({ tone, mod }))));

/** The page's rows after the read, flat, against whatever the registry holds. */
const toneRead = (tone) => toneRows(INFLUENCE_MODIFIERS[tone], TONE_PAGES[tone].table, INFLUENCE_DOC).flatMap((g) => g.mods);

/** INVENTED figures, one per key a tone page's rows name: none is a book's. */
const inventedTable = (tone) => {
  const table = {};
  let count = 0;
  for (const { mod } of toneRowsDeclared().filter((row) => row.tone === tone)) {
    for (const key of [mod.figure, ...(mod.rungs ?? []).map((r) => r.figure), ...Object.values(mod.autoFigures ?? {})]) {
      if (key && table[key] === undefined) table[key] = count++ % 2 ? 6 + count : -(6 + count);
    }
  }
  return table;
};

/** INVENTED bribe tier bonuses: none is a book's. */
const INVENTED_BRIBE = { tier1: 4, tier2: 6, tier3: 9 };

t("a tone page declares each row's figure by key and ships no figure", () => {
  for (const { tone, mod } of toneRowsDeclared()) {
    const where = `${tone}.${mod.key}`;
    assert.equal(mod.value, undefined, `${where}: no figure`);
    if (mod.figure !== undefined) assert.equal(mod.factor, undefined, `${where}: a figured row carries no factor`);
    assert.equal(mod.options, undefined, `${where}: no literal option table`);
    if (mod.key === "bribe") {
      assert.equal(mod.complete, true, `${where}: the tiers are read whole`);
      assert.equal(mod.table, "bribeTiers", `${where}: the tiers are their own page's`);
      assert.deepEqual(mod.rungs.map((r) => r.figure), ["tier1", "tier2", "tier3"], `${where}: one rung per tier, in place order`);
    }
    if (mod.factor !== undefined) assert.equal(Math.abs(mod.factor), 1, `${where}: a count's sign, not a figure`);
    for (const rung of mod.rungs ?? []) assert.equal(rung.value, undefined, `${where}.${rung.rung}: no figure`);
  }
  for (const [tone, page] of Object.entries(TONE_PAGES)) {
    assert.ok(page.table && /^JJ \d+$/.test(page.cite), `${tone}: names its table and page`);
  }
});

t("with nothing imported a figured row is disabled, contributes nothing and says not imported", () => {
  resetTables();
  for (const tone of Object.values(INFLUENCE_TONE)) {
    const declared = toneRowsDeclared().filter((row) => row.tone === tone).map((row) => row.mod);
    const read = toneRead(tone);
    assert.equal(read.length, declared.length, `${tone}: no row is dropped`);
    declared.forEach((mod, i) => {
      const row = read[i];
      const figured = mod.figure !== undefined || mod.rungs !== undefined;
      assert.equal(Boolean(row.disabled), figured, `${tone}.${mod.key}: disabled exactly when it carries a figure`);
      if (!figured) return;
      assert.equal(row.unread, true, `${tone}.${mod.key}`);
      assert.deepEqual(row.figureFrom, mod.table ? { docId: INFLUENCE_DOC, tableId: mod.table, cite: mod.cite } : { docId: INFLUENCE_DOC, tableId: TONE_PAGES[tone].table });
      if (mod.type === "select") assert.deepEqual(row.options.map((o) => o.value), [0], `${tone}.${mod.key}: only the blank`);
      if (mod.auto?.startsWith("prof:")) assert.equal(row.auto, undefined, `${tone}.${mod.key}: an unread box claims no item`);
    });
  }
  // A typed row is the Judge's, with or without an import.
  const authority = toneRead(INFLUENCE_TONE.DIPLOMACY).find((m) => m.key === "authority");
  assert.equal(authority.disabled, undefined);
  assert.equal(authority.type, "signed");
});

t("an unread proficiency box leaves its item to speak for itself", () => {
  resetTables();
  const groups = toneRows(INFLUENCE_MODIFIERS.diplomacy, TONE_PAGES.diplomacy.table, INFLUENCE_DOC);
  assert.equal(itemsWithProficiencyRows(actor, groups).has("i-dip"), false, "unread: the Diplomacy item's own effect still reaches the page");
  registerTable({ id: INFLUENCE_DOC, tables: { [TONE_PAGES.diplomacy.table]: inventedTable("diplomacy") } }, { priority: PRIORITY.WORLD });
  const read = toneRows(INFLUENCE_MODIFIERS.diplomacy, TONE_PAGES.diplomacy.table, INFLUENCE_DOC);
  assert.equal(itemsWithProficiencyRows(actor, read).has("i-dip"), true, "read: the box speaks and claims it");
  resetTables();
});

t("a read tone page is worth the imported figures, rung by rung", () => {
  resetTables();
  for (const tone of Object.values(INFLUENCE_TONE)) {
    const table = inventedTable(tone);
    registerTable({ id: INFLUENCE_DOC, tables: { [TONE_PAGES[tone].table]: table, bribeTiers: INVENTED_BRIBE } }, { priority: PRIORITY.WORLD });
    const declared = toneRowsDeclared().filter((row) => row.tone === tone).map((row) => row.mod);
    toneRead(tone).forEach((row, i) => {
      const mod = declared[i];
      assert.equal(row.disabled, undefined, `${tone}.${mod.key}: read`);
      if (mod.figure !== undefined && mod.type === "check") assert.equal(row.value, table[mod.figure], `${tone}.${mod.key}`);
      if (mod.figure !== undefined && mod.type === "factor") assert.equal(row.factor, table[mod.figure], `${tone}.${mod.key}`);
      if (mod.rungs) {
        const source = mod.table ? INVENTED_BRIBE : table;
        assert.equal(row.byIndex, true);
        assert.deepEqual(row.options.slice(1).map((o) => [o.rung, o.figure]), mod.rungs.map((r) => [r.rung, source[r.figure]]), `${tone}.${mod.key}: rungs in page order`);
        assert.deepEqual(row.options.map((o) => o.value), [0, ...mod.rungs.map((_, j) => j + 1)], `${tone}.${mod.key}: a blank, then each rung's own position`);
      }
    });
    resetTables();
  }
});

t("a rung the import did not read is left out, the rest stay", () => {
  resetTables();
  const tone = INFLUENCE_TONE.INTIMIDATION;
  const table = inventedTable(tone);
  delete table.outnumberYou2;
  registerTable({ id: INFLUENCE_DOC, tables: { [TONE_PAGES[tone].table]: table } }, { priority: PRIORITY.WORLD });
  const row = toneRead(tone).find((m) => m.key === "outnumber");
  assert.deepEqual(row.options.slice(1).map((o) => o.rung), ["outnumberYou1", "outnumberYou3", "outnumberTarget1", "outnumberTarget2", "outnumberTarget3"]);
  resetTables();
});

t("a rung is worded by the page when the import caught its row", () => {
  resetTables();
  const tone = INFLUENCE_TONE.INTIMIDATION;
  registerTable(
    { id: INFLUENCE_DOC, tables: { [TONE_PAGES[tone].table]: { ...inventedTable(tone), outnumberYou1Label: "  Invented wording  " } } },
    { priority: PRIORITY.WORLD },
  );
  const options = toneRead(tone).find((m) => m.key === "outnumber").options;
  assert.equal(options[1].printedLabel, "Invented wording");
  assert.equal(options[2].printedLabel, null);
  resetTables();
});

t("a figure says where it came from: the page, a Judge's override, or nothing imported", () => {
  resetTables();
  const tableId = TONE_PAGES.diplomacy.table;
  assert.deepEqual(figureOrigin(tableId, INFLUENCE_DOC), { state: "missing", cite: null });
  registerTable({ id: INFLUENCE_DOC, cites: { [tableId]: "JJ p. 0" }, tables: { [tableId]: { brandishing: 7 } } }, { priority: PRIORITY.WORLD });
  assert.deepEqual(figureOrigin(tableId, INFLUENCE_DOC), { state: "imported", cite: "JJ p. 0" });
  registerTable({ id: INFLUENCE_DOC, tables: { [tableId]: { brandishing: 8 } } }, { priority: PRIORITY.OVERRIDE });
  assert.deepEqual(figureOrigin(tableId, INFLUENCE_DOC), { state: "override", cite: null }, "an override has no page, and is not the same as absent");
  resetTables();
});

/** A character of a given level and alignment, as the auto sources read one. */
const sitter = (level, alignment = "") => ({
  type: "character",
  system: { details: { alignment, level }, scores: { cha: { mod: 0 }, wis: { mod: 0 } } },
  items: [],
  effects: [],
  getFlag: () => undefined,
});

t("alignment and level gap answer a direction; the rung and the figure are the page's", () => {
  resetTables();
  const ahead = sitter(9, "Lawful");
  const behind = sitter(1, "Chaotic");
  // Nothing imported: the rows are disabled, nothing is filled, and the
  // typed level-gap row has no threshold to answer from.
  const bare = computeDefaults(ahead, behind, Object.fromEntries(Object.values(INFLUENCE_TONE).map((tone) => [tone, toneRows(INFLUENCE_MODIFIERS[tone], TONE_PAGES[tone].table, INFLUENCE_DOC)])));
  assert.equal(bare.diplomacy.alignment, 0);
  assert.equal(bare.intimidation.levelGap, 0);
  assert.equal(bare.seduction.levelGap, 0);

  const dip = inventedTable("diplomacy");
  const intim = { ...inventedTable("intimidation"), levelGapMin: { value: 6, atLeast: true } };
  const sed = { ...inventedTable("seduction"), levelGapMin: { value: 6, atLeast: true } };
  registerTable(
    { id: INFLUENCE_DOC, tables: { [TONE_PAGES.diplomacy.table]: dip, [TONE_PAGES.intimidation.table]: intim, [TONE_PAGES.seduction.table]: sed } },
    { priority: PRIORITY.WORLD },
  );
  const config = () => Object.fromEntries(Object.values(INFLUENCE_TONE).map((tone) => [tone, toneRows(INFLUENCE_MODIFIERS[tone], TONE_PAGES[tone].table, INFLUENCE_DOC)]));
  const rungOf = (tone, key, value) => toneRead(tone).find((m) => m.key === key).options[value].rung;

  const opposed = computeDefaults(ahead, behind, config());
  assert.equal(rungOf("diplomacy", "alignment", opposed.diplomacy.alignment), "alignMismatch", "law against chaos is the clash rung");
  assert.equal(rungOf("seduction", "levelGap", opposed.seduction.levelGap), "levelGapHigh", "a gap of eight clears a threshold of six");
  assert.equal(opposed.intimidation.levelGap, intim.levelGapChar, "the typed row is filled with the page's figure for the character ahead");

  const reverse = computeDefaults(behind, ahead, config());
  assert.equal(rungOf("seduction", "levelGap", reverse.seduction.levelGap), "levelGapLow");
  assert.equal(reverse.intimidation.levelGap, intim.levelGapTarget, "and the target's figure when the target is ahead");

  const near = computeDefaults(sitter(5, "Lawful"), sitter(1, "Lawful"), config());
  assert.equal(rungOf("diplomacy", "alignment", near.diplomacy.alignment), "alignMatch");
  assert.equal(near.seduction.levelGap, 0, "a gap of four is under a threshold of six");
  assert.equal(near.intimidation.levelGap, 0);

  // The threshold is a floor: exactly the threshold meets it.
  const edge = computeDefaults(sitter(7, "Lawful"), sitter(1, "Lawful"), config());
  assert.equal(rungOf("seduction", "levelGap", edge.seduction.levelGap), "levelGapHigh");

  // A page that has its figures but not its threshold leaves the row alone.
  const { levelGapMin, ...noThreshold } = intim;
  registerTable({ id: INFLUENCE_DOC, tables: { [TONE_PAGES.intimidation.table]: noThreshold } }, { priority: PRIORITY.WORLD });
  assert.equal(computeDefaults(ahead, behind, config()).intimidation.levelGap, 0);
  resetTables();
});

t("a disabled row is neither pre-filled nor counted", () => {
  resetTables();
  const groups = toneRows(INFLUENCE_MODIFIERS.diplomacy, TONE_PAGES.diplomacy.table, INFLUENCE_DOC);
  const defaults = computeDefaults(sitter(1, "Lawful"), sitter(1, "Lawful"), { diplomacy: groups });
  assert.equal(defaults.diplomacy.alignment, 0, "an unread select stays on the blank");
  assert.equal(defaults.diplomacy.diplomacyProf, false, "an unread box is not auto-ticked");
});

/* --- the reaction table, the attitude ladder, the bribe tiers, aging and the bewitching mark --- */

const RESULT_KEYS = INFLUENCE_RESULTS.map((r) => r.key);

/** INVENTED edges and shift counts: none is a book's. */
const INVENTED_REACTION = {
  bands: [{ min: null, max: 3 }, { min: 4, max: 6 }, { min: 7, max: 9 }, { min: 10, max: 12 }, { min: 13, max: null }],
  shift1: 3,
  shift2: 2,
  shift3: 2,
  shift4: 2,
  shift5: 3,
};

t("a tone's result column is the page's edges and shift counts under the result keys", () => {
  resetTables();
  for (const page of Object.values(TONE_PAGES)) assert.equal(toneBands(page.reaction, RESULT_KEYS, INFLUENCE_DOC), null, "nothing imported: no result column");
  const tables = Object.fromEntries(Object.values(TONE_PAGES).map((page) => [page.reaction, INVENTED_REACTION]));
  registerTable({ id: INFLUENCE_DOC, tables }, { priority: PRIORITY.WORLD });
  const bands = toneBands(TONE_PAGES.diplomacy.reaction, RESULT_KEYS, INFLUENCE_DOC);
  assert.deepEqual(bands.map((b) => [b.key, b.min, b.max, b.shift]), [
    ["result1", undefined, 3, 3],
    ["result2", 4, 6, 2],
    ["result3", 7, 9, 2],
    ["result4", 10, 12, 2],
    ["result5", 13, undefined, 3],
  ]);
  // A count the import did not read leaves that result with no shift, not a zero.
  const { shift4, ...partial } = INVENTED_REACTION;
  registerTable({ id: INFLUENCE_DOC, tables: { [TONE_PAGES.seduction.reaction]: partial } }, { priority: PRIORITY.WORLD });
  assert.equal(toneBands(TONE_PAGES.seduction.reaction, RESULT_KEYS, INFLUENCE_DOC)[3].shift, null);
  assert.equal(toneBands(TONE_PAGES.seduction.reaction, RESULT_KEYS, INFLUENCE_DOC)[2].shift, 2);
  // Four edges where the ladder has five results is some other table.
  registerTable({ id: INFLUENCE_DOC, tables: { [TONE_PAGES.intimidation.reaction]: { ...INVENTED_REACTION, bands: INVENTED_REACTION.bands.slice(1) } } }, { priority: PRIORITY.WORLD });
  assert.equal(toneBands(TONE_PAGES.intimidation.reaction, RESULT_KEYS, INFLUENCE_DOC), null);
  resetTables();
});

t("each result has a direction on the ladder and no figure of its own", () => {
  assert.deepEqual(INFLUENCE_RESULTS.map((r) => r.initialIndex), [0, 1, 2, 3, 4]);
  assert.deepEqual(INFLUENCE_RESULTS.map((r) => r.direction), [-1, -1, 0, 1, 1]);
  assert.deepEqual(INFLUENCE_RESULTS.map((r) => r.towardNeutral), [false, false, true, false, false]);
  for (const r of INFLUENCE_RESULTS) assert.deepEqual(Object.keys(r).sort(), ["direction", "initialIndex", "key", "towardNeutral"]);
});

t("an attitude rung is worth what the page prints for it, and nothing where it prints none", () => {
  resetTables();
  const table = TONE_PAGES.diplomacy.attitude;
  assert.equal(attitudeFigure(table, 0, INFLUENCE_DOC), null, "not imported");
  registerTable({ id: INFLUENCE_DOC, tables: { [table]: { attitude0: -6, attitude1: 0, attitude3: 5 } } }, { priority: PRIORITY.WORLD });
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => attitudeFigure(table, i, INFLUENCE_DOC)), [-6, 0, null, 5, null]);
  assert.deepEqual(figureOrigin(table, INFLUENCE_DOC), { state: "imported", cite: null });
  assert.equal(TONE_PAGES.diplomacy.attitude === TONE_PAGES.seduction.attitude, false, "each page prints its own");
  resetTables();
});

t("the bribe row reads its tiers whole and stores each tier's place", () => {
  resetTables();
  const mode = { ...EXTERNAL_MODES.marketAssessment };
  const declared = mode.groups.flatMap((g) => g.mods).find((m) => m.key === "bribe");
  assert.deepEqual({ type: declared.type, ordinal: declared.ordinal, printed: declared.printed, printedDoc: declared.printedDoc }, { type: "ladder", ordinal: true, printed: "bribeTiers", printedDoc: INFLUENCE_DOC });
  const unread = rowOf(mode, "bribe");
  assert.deepEqual({ type: unread.type, disabled: unread.disabled, unread: unread.unread, options: unread.options.map((o) => o.value) }, { type: "select", disabled: true, unread: true, options: [0] });
  assert.deepEqual(unread.figureFrom, { docId: INFLUENCE_DOC, tableId: "bribeTiers", cite: declared.cite });
  // A tier missing leaves the whole row unread: the places after it would renumber.
  registerTable({ id: INFLUENCE_DOC, tables: { bribeTiers: { tier1: 4, tier3: 9 } } }, { priority: PRIORITY.WORLD });
  assert.equal(rowOf(mode, "bribe").disabled, true);
  registerTable({ id: INFLUENCE_DOC, tables: { bribeTiers: INVENTED_BRIBE } }, { priority: PRIORITY.WORLD });
  const read = rowOf(mode, "bribe");
  assert.equal(read.disabled, undefined);
  assert.deepEqual(read.options.map((o) => [o.value, o.figure]), [[0, 0], [1, 4], [2, 6], [3, 9]]);
  assert.equal(read.options[1].showFigure, true);
  resetTables();
});

/** A character of a given class and age, for the aging table's reader. */
const aged = (cls, age) => ({ system: { details: { class: cls, age } } });

t("an age category is read off the imported aging table, and none without it", () => {
  resetTables();
  assert.equal(ageCategoryIndex(aged("Fighter", 30)), null, "nothing imported");
  // INVENTED years: a human row of five categories and an elf row of two.
  registerTable({
    id: INFLUENCE_DOC,
    tables: {
      [AGING_PAGE.table]: {
        human: { youth: [10, 19], adult: [20, 39], middleAged: [40, 59], old: [60, 79], ancient: [80, 99] },
        elf: { youth: [10, 39], adult: [40, 300], middleAged: null, old: null, ancient: null },
      },
    },
  }, { priority: PRIORITY.WORLD });
  assert.deepEqual([5, 10, 19, 20, 45, 60, 85, 400].map((age) => ageCategoryIndex(aged("Fighter", age))), [0, 0, 0, 1, 2, 3, 4, 4]);
  assert.deepEqual([12, 40, 250].map((age) => ageCategoryIndex(aged("Elven Spellsword", age))), [0, 1, 1], "a race with two categories has two");
  assert.equal(ageCategoryIndex(aged("Gnomish Illusionist", 45)), 2, "a race the table has no row for counts as human");
  assert.equal(ageCategoryIndex(aged("Fighter", undefined)), 1, "an unstated age is taken as Adult");
  resetTables();
});

t("the age row counts the categories between the two, and leaves the row unfilled without the table", () => {
  resetTables();
  const withAge = (age) => ({ ...sitter(5, "Lawful"), system: { ...sitter(5).system, details: { ...sitter(5).system.details, class: "Fighter", age } } });
  registerTable({ id: INFLUENCE_DOC, tables: { [TONE_PAGES.seduction.table]: inventedTable("seduction") } }, { priority: PRIORITY.WORLD });
  const config = { seduction: toneRows(INFLUENCE_MODIFIERS.seduction, TONE_PAGES.seduction.table, INFLUENCE_DOC) };
  assert.equal(computeDefaults(withAge(45), withAge(25), config).seduction.age, 0, "no aging table: the count is left at zero");
  registerTable({ id: INFLUENCE_DOC, tables: { [AGING_PAGE.table]: { human: { youth: [10, 19], adult: [20, 39], middleAged: [40, 59], old: [60, 79], ancient: [80, 99] } } } }, { priority: PRIORITY.WORLD });
  assert.equal(computeDefaults(withAge(45), withAge(25), config).seduction.age, -1, "the character one category older than the target");
  assert.equal(computeDefaults(withAge(25), withAge(65), config).seduction.age, 2);
  assert.equal(computeDefaults(withAge(65), withAge(95), config).seduction.age, 0, "Ancient counts as Old");
  resetTables();
});

t("the bewitching mark is the page's, or none", () => {
  resetTables();
  assert.equal(bewitchMark(), null);
  registerTable({ id: INFLUENCE_DOC, tables: { [BEWITCH_PAGE.table]: { at: 14 } } }, { priority: PRIORITY.WORLD });
  assert.equal(bewitchMark(), 14);
  registerTable({ id: INFLUENCE_DOC, tables: { [BEWITCH_PAGE.table]: { at: "n/a" } } }, { priority: PRIORITY.WORLD });
  assert.equal(bewitchMark(), null, "a value of the wrong kind is unread");
  resetTables();
});

const { BRIBE_CRIME_PAGE } = await import("../scripts/influence/constants.mjs");
t("the bribery charge mark is the page's, or none", () => {
  resetTables();
  assert.equal(bribeCrimeMark(), null, "nothing imported names no mark");
  registerTable({ id: INFLUENCE_DOC, tables: { [BRIBE_CRIME_PAGE.table]: { natural: 5 } } }, { priority: PRIORITY.WORLD });
  assert.equal(bribeCrimeMark(), 5);
  registerTable({ id: INFLUENCE_DOC, tables: { [BRIBE_CRIME_PAGE.table]: { natural: 8 } } }, { priority: PRIORITY.OVERRIDE });
  assert.equal(bribeCrimeMark(), 8, "a Judge's override wins");
  assert.equal(figureOrigin(BRIBE_CRIME_PAGE.table, INFLUENCE_DOC).state, "override", "and the note names the override");
  resetTables();
  const lang = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  for (const key of ["ACKS-INFLUENCE.note.bribeCrime", "ACKS-INFLUENCE.note.bribeCrimeUnread"]) {
    assert.equal(/\d/.test(lang[key].replace(/\bRR \d+\b/g, "")), false, `${key}: states no figure`);
  }
});

t("no lang string of the tone pages carries a magnitude", () => {
  const lang = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  const keys = Object.keys(lang).filter((k) => /^ACKS-INFLUENCE\.(mod|opt|band|shift|mode\.(loyalty|irrefusable))\./.test(k));
  assert.ok(keys.length > 40, "the sweep reads the rows");
  for (const key of keys) {
    // A page reference and a tier's own ordinal are the places a digit may
    // stand; they are read past before looking for any other.
    const text = lang[key].replace(/\b(?:JJ|RR|MM) \d+(?:-\d+)?/g, "").replace(/\bTier \d\b/g, "");
    assert.equal(/\d/.test(text), false, `${key}: states a figure`);
  }
});

t("a character's race is the race of the class its name answers to, through the classes api", () => {
  const actor = (cls) => ({ type: ACTOR_TYPE.character, system: { details: { class: cls } } });
  const saved = globalThis.acksExtras.classes;
  try {
    // The api answers by the class's own record, never the name's words.
    globalThis.acksExtras.classes = { raceKeyOfClass: (name) => ({ "marsh warden": "people1", "fen reaver": "people2" })[name] ?? null };
    assert.equal(inferRace(actor("Marsh Warden")), "people1");
    assert.equal(inferRace(actor("Fen Reaver")), "people2");
    const kinds = kindOf(actor("Fen Reaver"));
    assert.equal(kinds.race, "people2");
    assert.ok(kinds.categories.has("human") && !kinds.categories.has("demi-human"), "a people race counts as human");
    // A name no class answers to falls to its common words, then to human.
    assert.equal(inferRace(actor("Elven Ranger")), "elf");
    assert.equal(inferRace(actor("Lamplighter")), "human");
    globalThis.acksExtras.classes = undefined;
    assert.equal(inferRace(actor("Marsh Warden")), "human", "with no classes api, a name without a common race word is human");
  } finally {
    globalThis.acksExtras.classes = saved;
  }
});

console.log(`\n${n} tests passed (influence modifier sources)`);
