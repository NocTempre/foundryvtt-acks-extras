/**
 * Damage against a creature's defenses (scripts/lib/defenses.mjs) and the one
 * reducer that takes its stage (scripts/lib/hp-logic.mjs `amountAfter`), the
 * weapon Apply that runs both (scripts/lib/attack-apply.mjs).
 *
 * Every creature, source, damage type pairing and figure below is INVENTED for
 * the test. Resistance's fraction and save modifier are the import's, so each
 * figure here is a stand-in registered the way an import registers it and is
 * no page's: a figure left in source fails the "nothing imported" cases.
 *
 * What this pins is the procedure: which band covers which type, the four
 * outcomes and the Judge's cases, that a type covered twice counts once, the
 * amount (one rounding, half to even), the save side, and that a press writes
 * once through the one writer and never when the case is the Judge's.
 */
import assert from "node:assert/strict";
import * as T from "../scripts/lib/tables.mjs";
import {
  DEFENSES_DOC, RESISTANCE_TABLE, actorDefenses, damageOf, defenseCite, defenseCoverage, defenseFigures, defenseSaveParts, defenseStage,
} from "../scripts/lib/defenses.mjs";
import { applyAttackHit, defenseWord, namesDefense, planAttackApply, stepsTip, undoAttackHit } from "../scripts/lib/attack-apply.mjs";
import { amountAfter } from "../scripts/lib/hp-logic.mjs";
import { actorReductions, reductionStage } from "../scripts/lib/defenses.mjs";
import { registerGate } from "../scripts/lib/typed-modifiers.mjs";
import { weaponGatesOf } from "../scripts/lib/patches/attack-throw.mjs";

let passed = 0;
const t = async (name, fn) => {
  T.unregisterTable(DEFENSES_DOC);
  await fn();
  T.unregisterTable(DEFENSES_DOC);
  passed++;
  console.log(`ok - ${name}`);
};

/** Invented figures, registered the way an import registers them. */
const FRACTION = 0.7;
const SAVE_BONUS = 6;
const importDefenses = (tables = { [RESISTANCE_TABLE]: { fraction: FRACTION, saveBonus: SAVE_BONUS } }, priority = T.PRIORITY.WORLD, pages = "ZZ p. 4") =>
  T.registerTable({ id: DEFENSES_DOC, source: { pages }, tables }, { priority });
const FIGURES = { fraction: FRACTION, saveBonus: SAVE_BONUS, cite: "ZZ p. 4" };

/** A stored band, as the sheet and the importer write one. */
const band = (b = {}) => ({ damage: [], effects: [], conditions: [], mundane: false, extraordinary: false, silverFlaw: false, note: "", ...b });
/** A source as `actorDefenses` yields it. */
const source = (name, { immune, resist, weak } = {}) => actorDefenses({ name, getFlag: (s, k) => (s === "acks-extras" && k === "extras" ? { defenses: { immunities: band(immune), resistances: band(resist), susceptibilities: band(weak) } } : undefined) })[0];
/** A hit whose quality is stated (mundane unless `extra` says otherwise); `unstated` below leaves it out. */
const hit = (types, extra = {}) => ({ types, extraordinary: false, ...extra });
const unstated = (types, extra = {}) => ({ types, extraordinary: null, ...extra });

await t("nothing imported: resistance's figures read null and no figure stands in", async () => {
  assert.deepEqual(defenseFigures(), { fraction: null, saveBonus: null, cite: null });
  assert.equal(defenseCite(), null);
});

await t("imported figures read back with their page; the Judge's override answers first and has no page", async () => {
  importDefenses();
  assert.deepEqual(defenseFigures(), { fraction: FRACTION, saveBonus: SAVE_BONUS, cite: "ZZ p. 4" });
  assert.equal(defenseCite(), "ZZ p. 4");
  importDefenses({ [RESISTANCE_TABLE]: { fraction: 0.4, saveBonus: -3 } }, T.PRIORITY.OVERRIDE);
  assert.deepEqual(defenseFigures(), { fraction: 0.4, saveBonus: -3, cite: null });
});

await t("a figure that is not one reads null: blank, text, out of range; zero is a save modifier but no fraction", async () => {
  for (const fraction of ["", null, "zzz", 0, -0.2, 1.3, NaN]) {
    T.unregisterTable(DEFENSES_DOC);
    importDefenses({ [RESISTANCE_TABLE]: { fraction, saveBonus: fraction } });
    assert.equal(defenseFigures().fraction, null, `fraction ${String(fraction)}`);
  }
  importDefenses({ [RESISTANCE_TABLE]: { fraction: "0.7", saveBonus: 0 } });
  assert.equal(defenseFigures().fraction, 0.7, "numeric text");
  assert.equal(defenseFigures().saveBonus, 0);
  T.unregisterTable(DEFENSES_DOC);
  importDefenses({ [RESISTANCE_TABLE]: { saveBonus: "" } });
  assert.equal(defenseFigures().saveBonus, null, "blank is not zero");
});

await t("actorDefenses names each source: the stat block and each owned item, skipping bands that reach no damage", async () => {
  const flags = {
    extras: { defenses: { immunities: band({ damage: ["cold", "variesByWeapon"] }), resistances: band(), susceptibilities: band() } },
  };
  const actor = {
    name: "Quillback",
    getFlag: (s, k) => (s === "acks-extras" ? flags[k] : undefined),
    items: [
      { name: "Quill Hide", getFlag: (s, k) => (k === "extras" ? { defenses: { resistances: band({ mundane: true }) } } : undefined) },
      { name: "Only Effects", getFlag: (s, k) => (k === "extras" ? { defenses: { immunities: band({ effects: "sleep, charm", conditions: ["frightened"], note: "a note" }) } } : undefined) },
      { name: "Plain Sword", getFlag: () => undefined },
      { name: "By Flags Object", flags: { "acks-extras": { extras: { defenses: { susceptibilities: band({ damage: new Set(["fire"]), factor: "2.5", save: -9 }) } } } } },
    ],
  };
  const sources = actorDefenses(actor);
  assert.deepEqual(sources.map((s) => s.name), ["Quillback", "Quill Hide", "By Flags Object"]);
  assert.deepEqual([...sources[0].bands.immunities.damage], ["cold", "varies"], "core's variesByWeapon is the module's varies");
  assert.equal(sources[1].bands.resistances.mundane, true);
  assert.equal(sources[2].bands.susceptibilities.factor, 2.5);
  assert.equal(sources[2].bands.susceptibilities.save, -9);
  assert.deepEqual(actorDefenses({ name: "Bare", getFlag: () => undefined, items: [] }), []);
  assert.deepEqual(actorDefenses(null), []);
  assert.equal(sources[0].bands.immunities.damage instanceof Set, true);
});

await t("three empty default bands cover nothing, so no creature is immune by default", async () => {
  const stamped = { name: "Blank", getFlag: (s, k) => (k === "extras" ? { defenses: { immunities: band(), resistances: band(), susceptibilities: band() } } : undefined), items: [] };
  assert.deepEqual(actorDefenses(stamped), []);
  const c = defenseCoverage(actorDefenses(stamped), hit(["fire"]));
  assert.equal(c.outcome, "none");
  assert.equal(defenseStage(actorDefenses(stamped), hit(["fire"]), FIGURES), null);
  assert.deepEqual(defenseSaveParts([], hit(["fire"]), FIGURES), { parts: [], pending: [], auto: null });
});

await t("a band names the types it covers, and no others", async () => {
  const s = [source("Ashen", { immune: { damage: ["fire", "cold"] } })];
  assert.equal(defenseCoverage(s, hit(["fire"])).outcome, "immune");
  assert.equal(defenseCoverage(s, hit(["fire", "cold"])).outcome, "immune");
  assert.equal(defenseCoverage(s, hit(["piercing"])).outcome, "none");
});

await t("damage with no type: a typed band does not cover it, and an empty type list is no vacuous immunity", async () => {
  const typed = [source("Ashen", { immune: { damage: ["fire"] } })];
  for (const types of [[], ["varies"], ["variesByWeapon"], undefined]) {
    assert.equal(defenseCoverage(typed, hit(types)).outcome, "none", JSON.stringify(types));
    assert.equal(defenseStage(typed, hit(types), FIGURES), null);
  }
  const quality = [source("Hollow", { immune: { mundane: true } })];
  assert.equal(defenseCoverage(quality, hit([])).outcome, "immune", "a quality-only band covers untyped mundane damage");
  assert.equal(defenseCoverage(quality, hit(["variesByWeapon"])).outcome, "immune");
  assert.equal(defenseCoverage(quality, hit([], { extraordinary: true })).outcome, "none");
});

await t("a quality flag covers the quality it names; a band with no flag covers both; a listing and a flag must both hold", async () => {
  const mundane = [source("A", { immune: { mundane: true } })];
  assert.equal(defenseCoverage(mundane, hit(["slashing"])).outcome, "immune");
  assert.equal(defenseCoverage(mundane, hit(["slashing"], { extraordinary: true })).outcome, "none");
  const extra = [source("B", { immune: { extraordinary: true } })];
  assert.equal(defenseCoverage(extra, hit(["slashing"])).outcome, "none");
  assert.equal(defenseCoverage(extra, hit(["slashing"], { extraordinary: true })).outcome, "immune");
  const both = [source("C", { immune: { mundane: true, extraordinary: true } })];
  assert.equal(defenseCoverage(both, hit(["slashing"])).outcome, "immune");
  assert.equal(defenseCoverage(both, hit(["slashing"], { extraordinary: true })).outcome, "immune");
  const named = [source("D", { immune: { damage: ["fire"] } })];
  assert.equal(defenseCoverage(named, hit(["fire"], { extraordinary: true })).outcome, "immune", "no flag: both qualities");
  const listedAndFlagged = [source("E", { immune: { damage: ["fire"], mundane: true } })];
  assert.equal(defenseCoverage(listedAndFlagged, hit(["fire"])).outcome, "immune");
  assert.equal(defenseCoverage(listedAndFlagged, hit(["fire"], { extraordinary: true })).outcome, "none", "the quality is not met");
  assert.equal(defenseCoverage(listedAndFlagged, hit(["cold"])).outcome, "none", "the type is not met");
});

await t("silver meets a defense's silver flaw: the hit is then extraordinary against that band alone", async () => {
  const flawed = [source("Flawed", { immune: { mundane: true, silverFlaw: true } })];
  const sound = [source("Sound", { immune: { mundane: true } })];
  assert.equal(defenseCoverage(flawed, hit(["slashing"], { silver: true })).outcome, "none", "silver is extraordinary here");
  assert.equal(defenseCoverage(sound, hit(["slashing"], { silver: true })).outcome, "immune", "no flaw, no change");
  assert.equal(defenseCoverage(flawed, hit(["slashing"])).outcome, "immune", "a plain blade is mundane");
  const reverse = [source("Reverse", { immune: { extraordinary: true, silverFlaw: true } })];
  assert.equal(defenseCoverage(reverse, hit(["slashing"], { silver: true })).outcome, "immune");
  const weak = [source("Weak", { weak: { mundane: true, silverFlaw: true } })];
  assert.equal(defenseCoverage(weak, hit(["slashing"], { silver: true })).outcome, "susceptible", "the flaw is no part of a susceptibility");
});

await t("every type immune: the stage takes the amount to zero, whatever else covers a type", async () => {
  const s = [source("Ashen", { immune: { damage: ["fire"] } }), source("Mantle", { resist: { damage: ["fire", "cold"] } }), source("Cloak", { immune: { damage: ["cold"] } })];
  const stage = defenseStage(s, hit(["fire", "cold"]), FIGURES);
  assert.equal(stage.factor, 0);
  assert.equal(stage.band, "immunities");
  assert.equal(stage.key, "defense");
  assert.deepEqual(stage.types, ["fire", "cold"]);
  assert.equal(stage.source, "Ashen, Mantle, Cloak");
  assert.equal(stage.cite, "ZZ p. 4");
  assert.equal(amountAfter(9, { stages: [stage] }).applied, 0);
});

await t("immune or resistant with one resistant: the imported fraction, once however many bands cover it", async () => {
  const once = [source("Mantle", { resist: { damage: ["fire"] } })];
  const twice = [...once, source("Cloak", { resist: { damage: ["fire"] } }), source("Ring", { resist: { damage: ["fire"] } })];
  const mixed = [source("Ashen", { immune: { damage: ["cold"] } }), ...once];
  for (const s of [once, twice]) {
    const stage = defenseStage(s, hit(["fire"]), FIGURES);
    assert.equal(stage.factor, FRACTION);
    assert.equal(stage.band, "resistances");
    assert.equal(amountAfter(10, { stages: [stage] }).applied, 7, "applied once: 10 x 0.7, not 10 x 0.49");
  }
  assert.equal(defenseStage(mixed, hit(["fire", "cold"]), FIGURES).factor, FRACTION, "an immunity beside a resistance on another type");
});

await t("a resistance whose fraction is not imported is the Judge's, never a default", async () => {
  const s = [source("Mantle", { resist: { damage: ["fire"] } })];
  const stage = defenseStage(s, hit(["fire"]), { fraction: null, saveBonus: null, cite: null });
  assert.equal(stage.judge, true);
  assert.equal(stage.why, "figure");
  assert.equal(stage.band, "judge");
  assert.equal(stage.factor, undefined);
  assert.equal(defenseStage(s, hit(["fire"])).judge, true, "figures left out read as none");
  assert.equal(defenseCoverage(s, hit(["fire"])).outcome, "resist");
});

await t("every type susceptible: the creature's own factor, once; a blank or disagreeing factor is the Judge's", async () => {
  const one = [source("Quillback", { weak: { damage: ["cold"], factor: 2.5 } })];
  const stage = defenseStage(one, hit(["cold"]), FIGURES);
  assert.equal(stage.factor, 2.5);
  assert.equal(stage.band, "susceptibilities");
  assert.equal(stage.cite, null, "the figure is the creature's own, not the page's");
  const agree = [...one, source("Hide", { weak: { damage: ["cold", "fire"], factor: 2.5 } })];
  assert.equal(defenseStage(agree, hit(["cold"]), FIGURES).factor, 2.5, "two bands, one factor, applied once");
  assert.equal(amountAfter(5, { stages: [defenseStage(agree, hit(["cold"]), FIGURES)] }).applied, 12, "12.5 rounds to the even whole");
  assert.equal(amountAfter(7, { stages: [defenseStage(agree, hit(["cold"]), FIGURES)] }).applied, 18, "17.5 rounds to the even whole");
  const differ = [...one, source("Hide", { weak: { damage: ["cold"], factor: 3 } })];
  assert.equal(defenseStage(differ, hit(["cold"]), FIGURES).why, "figure");
  const blank = [source("Quillback", { weak: { damage: ["cold"] } })];
  assert.equal(defenseStage(blank, hit(["cold"]), FIGURES).judge, true);
  assert.equal(defenseStage([source("Q", { weak: { damage: ["cold"], factor: 0 } })], hit(["cold"]), FIGURES).judge, true, "a factor of zero is not a factor");
});

await t("every other mixed case is the Judge's: a susceptibility on some types, beside a defense, a note, an uncovered type", async () => {
  const fireWeak = source("Quillback", { weak: { damage: ["fire"], factor: 2.5 } });
  const why = (sources, types) => {
    const stage = defenseStage(sources, hit(types), FIGURES);
    return stage?.judge ? stage.why : stage;
  };
  assert.equal(why([fireWeak], ["fire", "cold"]), "partial", "cold is covered by nothing");
  assert.equal(why([fireWeak, source("Mantle", { resist: { damage: ["cold"] } })], ["fire", "cold"]), "mixed", "a susceptibility on some types");
  assert.equal(why([fireWeak, source("Mantle", { resist: { damage: ["fire"] } })], ["fire"]), "mixed", "a susceptibility beside a resistance");
  assert.equal(why([fireWeak, source("Ashen", { immune: { damage: ["fire"] } })], ["fire"]), "mixed", "a susceptibility beside an immunity");
  assert.equal(why([source("Ashen", { immune: { damage: ["fire"] } })], ["fire", "cold"]), "partial", "an immunity to one of two types dealt");
});

await t("an applying band with a note goes to the Judge; a band that does not apply does not", async () => {
  const noted = [source("Ashen", { immune: { damage: ["fire"], note: "an exception the sets cannot carry" } })];
  const stage = defenseStage(noted, hit(["fire"]), FIGURES);
  assert.equal(stage.judge, true);
  assert.equal(stage.why, "note");
  assert.equal(defenseStage(noted, hit(["cold"]), FIGURES), null, "cold is not the band's, so the note is not in play");
  const effectsOnly = { name: "Hex", getFlag: (s, k) => (k === "extras" ? { defenses: { immunities: band({ effects: ["sleep"], note: "only a note" }) } } : undefined), items: [] };
  assert.deepEqual(actorDefenses(effectsOnly), [], "a band that holds only effects reaches no damage");
});

await t("a judge stage names the defenses and carries the page; other fields of a stage stay as the transparency step shape", async () => {
  const s = [source("Mantle", { resist: { damage: ["fire"] } }), source("Hide", { weak: { damage: ["fire"], factor: 2.5 } })];
  const stage = defenseStage(s, hit(["fire"]), FIGURES);
  assert.deepEqual(Object.keys(stage).sort(), ["band", "cite", "judge", "key", "label", "source", "types", "why"]);
  assert.equal(stage.source, "Mantle, Hide");
  assert.equal(stage.cite, "ZZ p. 4");
  assert.equal(typeof stage.label, "string");
});

await t("amountAfter: the save's fraction, then the defense stage, then ONE half-even rounding", async () => {
  const stage = defenseStage([source("Mantle", { resist: { damage: ["fire"] } })], hit(["fire"]), FIGURES);
  const out = amountAfter(20, { fraction: 0.4, stages: [stage] });
  assert.equal(out.applied, 6, "20 x 0.4 = 8, x 0.7 = 5.6, rounded once");
  assert.deepEqual(out.steps.map((s) => s.key), ["fraction", "defense", "round"]);
  assert.equal(out.steps[1].before, 8);
  assert.ok(Math.abs(out.steps[1].after - 5.6) < 1e-9);
  assert.deepEqual({ band: out.steps[1].band, types: out.steps[1].types, source: out.steps[1].source, cite: out.steps[1].cite }, { band: "resistances", types: ["fire"], source: "Mantle", cite: "ZZ p. 4" });
  assert.equal(out.steps[1].label, stage.label);
  assert.equal(amountAfter(5, { stages: [stage] }).applied, 4, "3.5 rounds to the even whole above");
  assert.equal(amountAfter(15, { stages: [stage] }).applied, 10, "10.5 rounds to the even whole below");
});

await t("amountAfter: a judge stage answers no amount, rounds nothing, and keeps the steps before it", async () => {
  const judge = defenseStage([source("Mantle", { resist: { damage: ["fire"] } })], hit(["fire"]), {});
  const out = amountAfter(11, { fraction: 0.4, stages: [judge, { key: "later", factor: 3 }] });
  assert.equal(out.applied, null);
  assert.equal(out.rolled, 11);
  assert.equal(out.judge, judge);
  assert.deepEqual(out.steps.map((s) => s.key), ["fraction"], "the later stage and the rounding never ran");
  assert.equal(amountAfter(11, { stages: [judge] }).steps.length, 0);
});

await t("amountAfter: a null stage is skipped, a defense's step is kept even where it changed nothing, other stages are as they were", async () => {
  assert.deepEqual(amountAfter(8, { stages: [null, undefined] }), { rolled: 8, applied: 8, steps: [] });
  const zero = defenseStage([source("Ashen", { immune: { damage: ["fire"] } })], hit(["fire"]), FIGURES);
  const out = amountAfter(0, { stages: [zero] });
  assert.equal(out.applied, 0);
  assert.deepEqual(out.steps.map((s) => s.key), ["defense"], "a defense met the hit even at 0");
  const plain = amountAfter(5, { stages: [{ key: "gift", label: "Gift", factor: 3 }, (n) => n + 1] });
  assert.deepEqual(plain, { rolled: 5, applied: 16, steps: [{ key: "gift", label: "Gift", before: 5, after: 15 }, { key: "stage1", before: 15, after: 16 }] });
});

await t("the save side: immunity is an automatic success; resistance a target part or pending; susceptibility the creature's own", async () => {
  const immune = defenseSaveParts([source("Ashen", { immune: { damage: ["fire"] } })], hit(["fire"]), FIGURES);
  assert.deepEqual(immune.parts, []);
  assert.deepEqual(immune.pending, []);
  assert.equal(immune.auto.source, "Ashen");
  assert.deepEqual(immune.auto.types, ["fire"]);
  const resist = defenseSaveParts([source("Mantle", { resist: { damage: ["fire"] } })], hit(["fire"]), FIGURES);
  assert.deepEqual(resist.parts.map((p) => [p.key, p.value, p.side]), [["defense", SAVE_BONUS, "target"]]);
  assert.equal(resist.parts[0].label, "Resistant");
  assert.equal(resist.auto, null);
  const unread = defenseSaveParts([source("Mantle", { resist: { damage: ["fire"] } })], hit(["fire"]), { fraction: FRACTION, saveBonus: null });
  assert.deepEqual(unread.parts, []);
  assert.deepEqual(unread.pending, [{ label: "Resistant", value: null, when: "defense", why: "figure" }]);
  const weak = defenseSaveParts([source("Quillback", { weak: { damage: ["cold"], factor: 2.5, save: -9 } })], hit(["cold"]), FIGURES);
  assert.deepEqual(weak.parts.map((p) => [p.key, p.value]), [["defense", -9]]);
  const weakBlank = defenseSaveParts([source("Quillback", { weak: { damage: ["cold"], factor: 2.5 } })], hit(["cold"]), FIGURES);
  assert.equal(weakBlank.pending[0].why, "figure");
});

await t("the save side: two resistances are one part, a mixed case is one pending row, a figure of zero adds nothing", async () => {
  const two = defenseSaveParts([source("Mantle", { resist: { damage: ["fire"] } }), source("Cloak", { resist: { damage: ["fire"] } })], hit(["fire"]), FIGURES);
  assert.equal(two.parts.length, 1);
  assert.equal(two.parts[0].value, SAVE_BONUS);
  const mixed = defenseSaveParts([source("Mantle", { resist: { damage: ["fire"] } }), source("Hide", { weak: { damage: ["fire"], factor: 2.5, save: -9 } })], hit(["fire"]), FIGURES);
  assert.deepEqual(mixed.parts, []);
  assert.deepEqual(mixed.pending, [{ label: "Judge's call", value: null, when: "defense", why: "mixed" }]);
  assert.equal(mixed.auto, null);
  const zero = defenseSaveParts([source("Mantle", { resist: { damage: ["fire"] } })], hit(["fire"]), { saveBonus: 0 });
  assert.deepEqual(zero, { parts: [], pending: [], auto: null });
});

await t("damageOf drops what is no type and keeps the flags as booleans", async () => {
  assert.deepEqual(damageOf({ types: ["fire", "fire", "variesByWeapon", "", 3], extraordinary: true, silver: 1 }), { types: ["fire"], extraordinary: true, silver: false });
  assert.deepEqual(damageOf({ types: ["fire"], extraordinary: false }).extraordinary, false);
  assert.deepEqual(damageOf(), { types: [], extraordinary: null, silver: false }, "an unstated quality is null, never mundane");
  assert.equal(damageOf({ types: ["fire"], extraordinary: undefined }).extraordinary, null);
  assert.deepEqual(damageOf({ types: new Set(["cold"]) }).types, ["cold"]);
});

await t("a quality the damage does not state is the Judge's wherever a band's coverage waits on it, and never read as mundane", async () => {
  const mundaneOnly = [source("Hollow", { immune: { mundane: true } })];
  const stage = defenseStage(mundaneOnly, unstated(["fire"]), FIGURES);
  assert.equal(stage.judge, true);
  assert.equal(stage.why, "quality");
  assert.equal(stage.band, "judge");
  assert.equal(stage.source, "Hollow");
  assert.equal(defenseCoverage(mundaneOnly, hit(["fire"])).outcome, "immune", "stated mundane: as before");
  assert.equal(defenseCoverage(mundaneOnly, hit(["fire"], { extraordinary: true })).outcome, "none");
  const typedMundane = [source("Typed", { resist: { damage: ["fire"], extraordinary: true } })];
  assert.equal(defenseCoverage(typedMundane, unstated(["fire"])).why, "quality", "a typed band with a flag waits too");
  assert.equal(defenseCoverage(typedMundane, unstated(["cold"])).outcome, "none", "a type the band does not list is covered by no quality");
  const typed = [source("Ashen", { immune: { damage: ["fire"] } })];
  assert.equal(defenseCoverage(typed, unstated(["fire"])).outcome, "immune", "a typed band with no flag covers both qualities");
  assert.equal(defenseStage(typed, unstated(["fire"]), FIGURES).factor, 0);
  const both = [source("Both", { immune: { mundane: true, extraordinary: true } })];
  assert.equal(defenseCoverage(both, unstated([])).outcome, "immune", "both flags cover both qualities");
  const flawed = [source("Flawed", { immune: { mundane: true, silverFlaw: true } })];
  assert.equal(defenseCoverage(flawed, unstated(["fire"], { silver: true })).outcome, "none", "silver on a flaw is extraordinary though unstated");
  assert.equal(defenseCoverage(flawed, unstated(["fire"])).why, "quality");
});

await t("an unstated quality that changes nothing is not the Judge's; one that could change the outcome is", async () => {
  const sure = source("Ashen", { immune: { damage: ["fire"] } });
  const maybe = source("Hollow", { resist: { mundane: true } });
  assert.equal(defenseCoverage([sure, maybe], unstated(["fire"])).outcome, "immune", "immune whether or not the mundane resistance covers");
  const sureResist = source("Mantle", { resist: { damage: ["fire"] } });
  const maybeImmune = source("Hollow", { immune: { mundane: true } });
  assert.equal(defenseCoverage([sureResist, maybeImmune], unstated(["fire"])).why, "quality", "resist or immune depends on it");
  const weakSure = source("Quillback", { weak: { damage: ["fire"], factor: 2.5 } });
  assert.equal(defenseCoverage([weakSure, source("Hollow", { weak: { extraordinary: true, factor: 2.5 } })], unstated(["fire"])).outcome, "susceptible", "the same factor either way");
});

await t("the save side: an unstated quality is pending, never an automatic success", async () => {
  const mundaneOnly = [source("Hollow", { immune: { mundane: true } })];
  const held = defenseSaveParts(mundaneOnly, unstated(["fire"]), FIGURES);
  assert.equal(held.auto, null);
  assert.deepEqual(held.parts, []);
  assert.deepEqual(held.pending, [{ label: "Judge's call", value: null, when: "defense", why: "quality" }]);
  assert.ok(defenseSaveParts(mundaneOnly, hit(["fire"]), FIGURES).auto, "stated mundane: automatic");
  const typed = [source("Ashen", { immune: { damage: ["fire"] } })];
  assert.ok(defenseSaveParts(typed, unstated(["fire"]), FIGURES).auto, "a band with no quality flag covers both");
  const resist = [source("Mantle", { resist: { damage: ["fire"] } })];
  assert.equal(defenseSaveParts(resist, unstated(["fire"]), FIGURES).parts[0].value, SAVE_BONUS, "normal outcome");
});

/* ------------------------- the weapon Apply ------------------------- */

const actorOf = (...sources) => ({ name: "Target", items: [], getFlag: () => undefined, __sources: sources });
const STAMP = { targetUuid: "Scene.s.Token.t", rolled: 10, types: ["fire"], extraordinary: false, silver: false };
const found = (hp = 20, reason = null) => ({ actor: actorOf(), hpTarget: { key: "Actor.target", hp: { value: hp, max: 30 }, reason } });
const writer = (written = []) => async (entries) => {
  written.push(...entries);
  return entries.map((e) => ({ ok: true, before: 20, after: 20 - e.amount, target: e.target, amount: e.amount }));
};

await t("planAttackApply reduces the stamped figure through the one reducer", async () => {
  const mantle = [source("Mantle", { resist: { damage: ["fire"] } })];
  const plan = planAttackApply(STAMP, actorOf(), { sources: mantle, figures: FIGURES });
  assert.equal(plan.applied, 7);
  assert.deepEqual(plan.steps.map((s) => s.key), ["defense"]);
  assert.equal(planAttackApply(STAMP, actorOf(), { sources: [], figures: FIGURES }).applied, 10, "no defense, the rolled figure");
  assert.equal(planAttackApply({ ...STAMP, rolled: 0 }, actorOf(), { sources: [], figures: FIGURES }).applied, 0);
});

/* --- a reduction per die ---------------------------------------------------- */

const reduction = (source, per, { gate = null, cite = "" } = {}) => ({ source, cite, per, gate });

await t("a reduction is read off an ability's row: per die, a positive figure, one of the weapon gates, copies once", () => {
  const row = (extra = {}) => ({ type: "modifier", target: "damageReduction", perDie: true, value: 2, ...extra });
  const ability = (name, effects, cite = "") => ({ type: "ability", name, flags: { "acks-extras": { extras: { effects }, ...(cite ? { cookbook: { cite } } : {}) } } });
  const read = (...items) => actorReductions({ type: "monster", items });
  assert.deepEqual(read(ability("Hide", [row({ gate: { kind: "weaponMundane" } })], "Pg 2")), [{ source: "Hide", cite: "Pg 2", per: 2, gate: "weaponMundane" }]);
  assert.deepEqual(read(ability("Hide", [row()])), [{ source: "Hide", cite: "", per: 2, gate: null }], "no gate: every hit");
  assert.deepEqual(read(ability("Odd", [row({ gate: { kind: "unregistered" } })])).map((r) => r.gate), ["?"], "a gate it cannot read is kept to be refused");
  assert.deepEqual(read(ability("Flat", [row({ perDie: false })]), ability("None", [row({ value: null })]), ability("Zero", [row({ value: 0 })]), ability("Theirs", [row({ appliesTo: "opponent" })])), [], "not per die, no figure, a zero, or the opponent's");
  assert.equal(read(ability("Hide", [row()]), ability("Hide", [row()])).length, 1);
  assert.deepEqual(actorReductions(null), []);
});

await t("the stage takes the figure for each die, never below zero, for the gated kind only", () => {
  const stamp = { dice: 3, gates: { weaponMundane: true, weaponMagical: false } };
  const mundane = reduction("Hide", 2, { gate: "weaponMundane", cite: "Pg 2" });
  const { stage, skipped } = reductionStage([mundane], stamp);
  assert.deepEqual([stage.key, stage.minus, stage.per, stage.dice, stage.source, stage.cite, stage.band], ["perDie", 6, 2, 3, "Hide", "Pg 2", "reduction"], "2 per die over 3 dice");
  assert.deepEqual(skipped, []);
  assert.equal(amountAfter(10, { stages: [stage] }).applied, 4);
  const floored = amountAfter(5, { stages: [stage] });
  assert.equal(floored.applied, 0, "never below zero");
  assert.deepEqual(floored.steps.find((s) => s.key === "perDie"), { key: "perDie", label: stage.label, band: "reduction", source: "Hide", cite: "Pg 2", per: 2, dice: 3, before: 5, after: 0 }, "the step names source, page and the figures");
  assert.equal(reductionStage([mundane], { ...stamp, gates: { weaponMundane: false } }).stage, null, "a weapon of the other kind is not reduced");
  assert.deepEqual(reductionStage([mundane], { ...stamp, gates: { weaponMundane: false } }).skipped, [], "and that is not news");
  assert.equal(reductionStage([reduction("Any", 1)], { dice: 2 }).stage.minus, 2, "no gate: every hit");
  const two = reductionStage([reduction("A", 1, { cite: "p1" }), reduction("B", 2, { cite: "p1" }), reduction("C", 5, { gate: "weaponMagical" })], stamp).stage;
  assert.deepEqual([two.minus, two.source, two.cite], [9, "A, B", "p1"], "carriers add, and a gate that does not hold leaves one out");
});

await t("no die count, or a gate nothing can answer, is no stage and a reason", () => {
  const mundane = reduction("Hide", 2, { gate: "weaponMundane" });
  assert.deepEqual(reductionStage([mundane], { gates: { weaponMundane: true } }), { stage: null, skipped: [{ source: "Hide", why: "dice" }] }, "an older card carries no dice");
  assert.deepEqual(reductionStage([mundane], { dice: 0, gates: { weaponMundane: true } }).skipped, [{ source: "Hide", why: "dice" }]);
  assert.deepEqual(reductionStage([mundane], { dice: 3, gates: { weaponMundane: null } }), { stage: null, skipped: [{ source: "Hide", why: "gate" }] }, "a weapon whose magic nothing could say");
  assert.deepEqual(reductionStage([mundane], { dice: 3 }).skipped, [{ source: "Hide", why: "gate" }]);
  assert.deepEqual(reductionStage([reduction("Odd", 1, { gate: "?" })], { dice: 3 }).skipped, [{ source: "Odd", why: "gate" }]);
  assert.deepEqual(reductionStage([], { dice: 3 }), { stage: null, skipped: [] });
});

await t("the weapon's gates are stamped from the registered gate kinds, and the plan runs the reduction before the defense", () => {
  registerGate("weaponMundane", (_a, _g, ctx) => (ctx?.item ? !ctx.item.magic : null), { at: "item" });
  registerGate("weaponMagical", (_a, _g, ctx) => (ctx?.item ? ctx.item.magic === true : null), { at: "item" });
  assert.deepEqual(weaponGatesOf({ magic: false }), { weaponMundane: true, weaponMagical: false });
  assert.deepEqual(weaponGatesOf({ magic: true }), { weaponMundane: false, weaponMagical: true });
  assert.deepEqual(weaponGatesOf(null), { weaponMundane: null, weaponMagical: null }, "an attack with no weapon states neither");
  const stamp = { ...STAMP, rolled: 10, dice: 2, gates: { weaponMundane: true, weaponMagical: false } };
  const hide = [reduction("Hide", 1, { gate: "weaponMundane", cite: "Pg 2" })];
  const mantle = [source("Mantle", { resist: { damage: ["fire"] } })];
  const plan = planAttackApply(stamp, actorOf(), { sources: mantle, figures: FIGURES, reductions: hide });
  assert.deepEqual(plan.steps.map((s) => s.key).slice(0, 2), ["perDie", "defense"], "the reduction acts on the dice first");
  assert.equal(plan.applied, 6, "10 less 2, then the resistant fraction");
  assert.equal(plan.skipped, undefined);
  assert.equal(planAttackApply({ ...stamp, dice: undefined }, actorOf(), { sources: [], figures: FIGURES, reductions: hide }).skipped[0].why, "dice");
  assert.equal(planAttackApply(stamp, actorOf(), { sources: [], figures: FIGURES, reductions: [] }).applied, 10, "no reduction, the rolled figure");
  const tip = stepsTip(10, plan.steps, true, (key, data) => `${key}|${data.source ?? data.defense ?? ""}|${data.per ?? ""}|${data.after}`);
  assert.match(tip, /step\.perDie\|Hide\|1\|8/, "the card's tooltip names the reduction");
});

await t("a press writes once through the writer at multiplier 1 and stores the result", async () => {
  const written = [];
  const done = await applyAttackHit(STAMP, found(), { adjustHp: writer(written), by: "u1", sources: [source("Mantle", { resist: { damage: ["fire"] } })], figures: FIGURES });
  assert.equal(done.state, "applied");
  assert.equal(written.length, 1);
  assert.equal(written[0].amount, 7);
  assert.equal(written[0].multiplier, 1);
  assert.deepEqual({ applied: done.result.applied, before: done.result.before, after: done.result.after, by: done.result.by, state: done.result.state }, { applied: 7, before: 20, after: 13, by: "u1", state: "applied" });
  assert.equal(done.result.steps[0].source, "Mantle");
});

await t("a press with nothing to write stores a result; a judge stage, a refused target and a failed write store none", async () => {
  const written = [];
  const immune = await applyAttackHit(STAMP, found(), { adjustHp: writer(written), sources: [source("Ashen", { immune: { damage: ["fire"] } })], figures: FIGURES });
  assert.equal(immune.state, "applied");
  assert.equal(immune.result.applied, 0);
  assert.deepEqual([immune.result.before, immune.result.after], [20, 20]);
  assert.deepEqual(written, [], "an amount of 0 writes nothing");
  const judge = await applyAttackHit(STAMP, found(), { adjustHp: writer(written), sources: [source("Mantle", { resist: { damage: ["fire"] } })], figures: { fraction: null, saveBonus: null } });
  assert.equal(judge.state, "judge");
  assert.equal(judge.judge.why, "figure");
  assert.equal(judge.result, undefined);
  const stack = await applyAttackHit(STAMP, found(20, "stack"), { adjustHp: writer(written), sources: [], figures: FIGURES });
  assert.deepEqual(stack, { state: "refused", why: "stack" });
  assert.deepEqual(await applyAttackHit(STAMP, null, { adjustHp: writer(written) }), { state: "refused", why: "gone" });
  assert.deepEqual(await applyAttackHit(STAMP, { actor: {}, hpTarget: null }, { adjustHp: writer(written) }), { state: "refused", why: "gone" });
  const failed = await applyAttackHit(STAMP, found(), { adjustHp: async () => [{ ok: false, why: "failed" }], sources: [], figures: FIGURES });
  assert.deepEqual(failed, { state: "refused", why: "failed" });
  assert.deepEqual(written, [], "none of those wrote");
});

await t("Undo restores the hit points it took and marks the result undone; a result not applied is left as it is", async () => {
  const restored = [];
  const deps = { restoreHp: async (rows) => restored.push(...rows) };
  const result = { state: "applied", applied: 7, before: 20, after: 13, steps: [] };
  const back = await undoAttackHit(result, found(13), deps);
  assert.equal(back.state, "undone");
  assert.deepEqual(restored.map((r) => [r.before, r.after, r.ok]), [[20, 13, true]]);
  assert.equal((await undoAttackHit(back, found(), deps)).state, "undone");
  assert.equal(restored.length, 1, "a second Undo restores nothing");
  const none = await undoAttackHit({ state: "applied", applied: 0, before: 20, after: 20 }, found(), deps);
  assert.equal(none.state, "undone");
  assert.equal(restored.length, 1, "nothing to put back");
});

await t("the defense is named to a Judge and to the target's owners; other seats read \"a defense\"", async () => {
  const loc = (key, data = {}) => `${key}:${Object.values(data).join("|")}`;
  const step = { key: "defense", label: "Resistant", source: "Mantle", before: 10, after: 7 };
  assert.equal(namesDefense({ isGM: true }), true);
  assert.equal(namesDefense({ ownsTarget: true }), true);
  assert.equal(namesDefense({}), false);
  assert.equal(defenseWord(step, true, loc), "defenseNamed:Resistant|Mantle");
  assert.equal(defenseWord(step, false, loc), "defenseUnnamed:");
  assert.equal(defenseWord({ ...step, source: "" }, true, loc), "Resistant");
  const named = stepsTip(10, [step, { key: "round", before: 7.4, after: 7 }], true, loc);
  assert.ok(named.includes("Mantle"));
  const hidden = stepsTip(10, [step, { key: "round", before: 7.4, after: 7 }], false, loc);
  assert.equal(hidden.includes("Mantle"), false);
  assert.ok(hidden.includes("defenseUnnamed"));
});

console.log(`\n${passed} passed`);
