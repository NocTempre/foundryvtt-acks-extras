/**
 * What the importer reads of a creature's defenses and of resistance's two
 * printed figures, and how a monster binding stores a band.
 *
 * Every creature and every sentence below is INVENTED, and every figure in a
 * fixture differs from the one a page prints: what this pins is the reading
 * (a flaw read from a sentence of its own, a susceptibility's multiple and
 * save modifier read only beside their cue, an unread figure left absent) and
 * that the resistance recipe's anchors find a clause by its words and take the
 * figure after it. The recipe against the real page is `test-recipe-content`.
 */
import assert from "node:assert/strict";
import { defenseScan, mergeDefenses } from "../../scripts/importer/executor.mjs";
import { packDefenseBand, buildExtras } from "../../scripts/importer/cookbook/monster.mjs";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`ok   ${name}`);
};

const scan = (...lines) => defenseScan(lines.map((text) => ({ text })), {});

/* --- the silver flaw ------------------------------------------------------ */

t("a sentence saying silver counts as extraordinary sets the flaw on the defense it changes", () => {
  const out = scan(
    "The mothwraith is immune to all mundane damage. However, damage dealt by silver weapons is considered to be extraordinary damage.",
  );
  assert.equal(out.immunities.mundane, true);
  assert.equal(out.immunities.silverFlaw, true);
});

t("a silver flaw on a resistance sets it there, and an immunity that turns on no quality takes none", () => {
  const out = scan(
    "The ashhound is resistant to mundane damage and immune to cold damage.",
    "It treats silver weapons as if they were magic.",
  );
  assert.equal(out.resistances.silverFlaw, true);
  assert.ok(!("silverFlaw" in out.immunities), "the cold immunity names no quality");
});

t("silver named as treasure, or in a sentence that does not call it extraordinary, is no flaw", () => {
  const treasure = scan("The vault hound is immune to mundane damage.", "Its lair holds a silver ring and a silver weapon rack.");
  assert.ok(!("silverFlaw" in treasure.immunities));
  const covered = scan("The brass shade is immune to mundane damage and to silver weapons.");
  assert.ok(!("silverFlaw" in covered.immunities));
});

t("the flaw without a defense it can change reads no band", () => {
  assert.equal(scan("Damage dealt by silver weapons is considered to be extraordinary damage."), null);
});

/* --- a susceptibility's figures ------------------------------------------- */

t("the multiple and the save modifier are read from the creature's own sentences, signs and all", () => {
  const out = scan("The reedling is susceptible to cold damage. It saves against cold at a −3 penalty and suffers triple damage dice.");
  assert.deepEqual(out.susceptibilities.damage, ["cold"]);
  assert.equal(out.susceptibilities.factor, 3);
  assert.equal(out.susceptibilities.save, -3);
});

t("a figure in the sentence that names the susceptibility is read too", () => {
  const out = scan("The sandmite is vulnerable to fire damage and takes twice damage from it, saving at +1.");
  assert.equal(out.susceptibilities.factor, 2);
  assert.equal(out.susceptibilities.save, 1);
});

t("a susceptibility that prints no figure stays without them", () => {
  const out = scan("The reedling is susceptible to cold damage.", "It keeps to the reeds.");
  assert.deepEqual(out.susceptibilities.damage, ["cold"]);
  assert.ok(!("factor" in out.susceptibilities) && !("save" in out.susceptibilities));
});

t("a multiple or a modifier with no cue beside it, or past the next sentence, is not read", () => {
  const stray = scan(
    "The reedling is susceptible to cold damage.",
    "It moves twice as fast in water. It deals double damage with its bite.",
    "Its allies fight at +2 to attack throws.",
  );
  assert.ok(!("factor" in stray.susceptibilities), "twice as fast and a bite are no multiple of damage taken");
  assert.ok(!("save" in stray.susceptibilities), "an attack bonus is no save modifier");
  const far = scan("The reedling is susceptible to cold damage.", "It keeps to the reeds.", "It takes double damage from salt.");
  assert.ok(!("factor" in far.susceptibilities), "the third sentence is out of reach");
});

/* --- merging with the type's own defenses ---------------------------------- */

t("a merge keeps the creature's figures over the type's, ORs the flaw and unions the conditions", () => {
  const own = { susceptibilities: { damage: ["fire"], effects: [], mundane: false, extraordinary: false, factor: 3, save: -1 }, immunities: { damage: [], effects: [], mundane: true, extraordinary: false, silverFlaw: true } };
  const type = {
    susceptibilities: { damage: ["cold"], effects: [], mundane: false, extraordinary: false, factor: 2, save: -4, note: "while wet" },
    immunities: { damage: ["poisonous"], effects: ["charm"], conditions: ["stunned"], mundane: false, extraordinary: false },
  };
  const out = mergeDefenses(own, type);
  assert.deepEqual(out.susceptibilities.damage, ["fire", "cold"]);
  assert.equal(out.susceptibilities.factor, 3);
  assert.equal(out.susceptibilities.save, -1);
  assert.equal(out.susceptibilities.note, "while wet");
  assert.equal(out.immunities.silverFlaw, true);
  assert.deepEqual(out.immunities.conditions, ["stunned"]);
  assert.equal(out.immunities.mundane, true);
});

t("a merge of bands with no flaw, figure, condition or note adds none of those keys", () => {
  const out = mergeDefenses(
    { resistances: { damage: ["fire"], effects: [], mundane: false, extraordinary: false } },
    { resistances: { damage: ["cold"], effects: [], mundane: false, extraordinary: false } },
  );
  assert.deepEqual(out.resistances, { damage: ["fire", "cold"], effects: [], mundane: false, extraordinary: false });
});

/* --- the stored band ------------------------------------------------------- */

t("a band is stored with its effects as a set, never a joined string", () => {
  const band = packDefenseBand({ damage: ["fire"], effects: ["charm", "sleep"], mundane: true }, false);
  assert.deepEqual(band.effects, ["charm", "sleep"]);
  assert.deepEqual(band.conditions, []);
  assert.equal(band.silverFlaw, false);
  assert.ok(!("note" in band) && !("factor" in band) && !("save" in band));
});

t("a band keeps its flaw, conditions and note, and only a susceptibility carries figures, only when read", () => {
  const raw = { damage: [], effects: [], conditions: ["stunned"], extraordinary: true, silverFlaw: true, note: "except by its own kind", factor: 2, save: -2 };
  const immune = packDefenseBand(raw, false);
  assert.equal(immune.silverFlaw, true);
  assert.deepEqual(immune.conditions, ["stunned"]);
  assert.equal(immune.note, "except by its own kind");
  assert.ok(!("factor" in immune), "an immunity has no figures");
  const weak = packDefenseBand(raw, true);
  assert.equal(weak.factor, 2);
  assert.equal(weak.save, -2);
  assert.ok(!("factor" in packDefenseBand({ damage: ["fire"] }, true)), "an unread figure stays absent");
  assert.equal(packDefenseBand(undefined, true), undefined);
});

t("the monster binding writes each band through it", () => {
  const extras = buildExtras({
    fields: {
      defenses: {
        immunities: { damage: ["cold"], effects: ["sleep"], mundane: false, extraordinary: false },
        susceptibilities: { damage: ["fire"], effects: [], mundane: false, extraordinary: false, factor: 2 },
      },
    },
  });
  assert.deepEqual(extras.defenses.immunities.effects, ["sleep"]);
  assert.equal(extras.defenses.susceptibilities.factor, 2);
  assert.ok(!("resistances" in extras.defenses));
});

/* --- resistance's recipe, against invented prose ---------------------------- */

const recipe = TABLE_RECIPES.defenses.tables.resistanceProse;
const page = (lines) => lines.map((str, i) => ({ x: 100, y: 100 + i * 12, str }));
const read = (lines) => extractTable(page(lines), { ...recipe, column: { xMin: 20, xMax: 600 } });

t("the recipe locates each figure by the words before it and takes the figure after them", () => {
  const out = read([
    "Some folk are proof against a kind of blow. When a warden is resistant to a damage",
    "type, it suffers only one third damage from that type. It also gains a +4 bonus on",
    "saving throws against that kind of blow.",
  ]);
  assert.ok(Math.abs(out.fraction - 1 / 3) < 1e-9, "the share is read from its word");
  assert.equal(out.saveBonus, 4);
});

t("a share written as a different word and a penalty are read as the page writes them", () => {
  const out = read(["A warden resistant to a damage type, it suffers only a quarter of that type. It also gains a -1 modifier to saves."]);
  assert.equal(out.fraction, 0.25);
  assert.equal(out.saveBonus, -1);
});

t("a page whose clauses differ reads neither figure, and a missing one is absent", () => {
  assert.deepEqual(read(["Wardens guard the pass in all weather. Nothing here names a share or a bonus."]), {});
  const fifth = read(["A warden is resistant to a damage type, it suffers only one fifth of that type."]);
  assert.equal(fifth.fraction, 0.2);
  assert.ok(!("saveBonus" in fifth), "no sentence after the first, no modifier");
});

t("the recipe's anchors name no figure", () => {
  for (const v of recipe.values) assert.ok(!/\d|half|third|quarter|twice|double/i.test(v.findRe ?? v.find), `${v.key}: the anchor holds a figure`);
});

console.log(`test-defense-scan: ${passed} checks passed.`);
