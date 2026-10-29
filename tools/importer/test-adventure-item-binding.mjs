/**
 * An item a book introduces, read beside its prose
 * (`adventure-item-binding.mjs`): the place it is worn, its stated price and
 * its magic mark. Every paragraph here is invented: no PDFs, no Foundry.
 */
import assert from "node:assert/strict";
import { adventureItemShape, wornPlaceIn, priceStatedIn, isCraftedIn } from "../../scripts/importer/adventure-item-binding.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ---------------- where it is worn ---------------- */

t("a thing wrapped around the palms is handwear", () => {
  assert.equal(wornPlaceIn("Wrapped around the palms, these cloths steady the wearer's grip. Cost: 40 gp and 1 week to craft"), "hands");
});

t("a thing worn around the wrists is handwear, by the earliest place named", () => {
  assert.equal(wornPlaceIn("Worn around the wrists, these bands warm the wearer's hands and feet alike."), "hands");
});

t("a belt, a sash and a bandolier are belt-worn", () => {
  assert.equal(wornPlaceIn("When worn, this belt tightens on its own."), "belt");
  assert.equal(wornPlaceIn("When worn, this bandolier holds six vials."), "belt");
  assert.equal(wornPlaceIn("A sash the wearer ties at the waist."), "belt");
});

t("a thing tied to a tail is worn, at no capped place, whatever the wearer later does with a hand", () => {
  assert.equal(wornPlaceIn("A ribbon that can only be tied around the tail of a creature. The wearer may hand it on."), "worn");
});

t("a bell the wearer rings is not a ring", () => {
  assert.equal(wornPlaceIn("A bell attached to the tail. Once a day the wearer rings it."), "worn");
  assert.equal(wornPlaceIn("A band worn on a finger."), "ring");
});

t("the other places answer to their own words", () => {
  assert.equal(wornPlaceIn("Boots worn on the feet."), "feet");
  assert.equal(wornPlaceIn("A circlet worn on the brow."), "head");
  assert.equal(wornPlaceIn("An amulet hung at the throat."), "neck");
  assert.equal(wornPlaceIn("A cloak draped over the shoulders."), "shoulders");
});

t("a wearing clause with no place named is worn", () => {
  assert.equal(wornPlaceIn("While worn, the charm hums softly."), "worn");
});

t("a thing nobody wears has no place", () => {
  assert.equal(wornPlaceIn("When ingested by a beast, it must save. Cost: 1 sp per dose"), null);
  assert.equal(wornPlaceIn("A wand of ash. Cost: 900 gp and 1 month to craft"), null);
  assert.equal(wornPlaceIn(""), null);
  assert.equal(wornPlaceIn(null), null);
});

/* ---------------- the price ---------------- */

t("a cost line is read in gp, with thousands separators", () => {
  assert.equal(priceStatedIn("Cost: 5,000 gp and 1 month to craft"), 5000);
  assert.equal(priceStatedIn("Cost 12gp"), 12);
  assert.equal(priceStatedIn("Cost: 2.5 gp"), 2.5);
});

t("silver and copper prices are read as fractions of a gp", () => {
  assert.equal(priceStatedIn("Cost: 5 sp per dose"), 0.5);
  assert.equal(priceStatedIn("Cost: 25 cp"), 0.25);
});

t("no cost line, no price", () => {
  assert.equal(priceStatedIn("A gift; it is never sold."), null);
  assert.equal(priceStatedIn("It costs the wearer a hit point a day."), null);
});

/* ---------------- the magic mark ---------------- */

t("a crafting time marks a made magic item; a dose carries none", () => {
  assert.equal(isCraftedIn("Cost: 5,000 gp and 1 month to craft"), true);
  assert.equal(isCraftedIn("Crafting time: six weeks."), true);
  assert.equal(isCraftedIn("Cost: 1 sp per dose"), false);
});

/* ---------------- the shape, whole ---------------- */

t("the shape carries the three answers together", () => {
  assert.deepEqual(adventureItemShape("Worn around the wrists, these bands warm the hands. Cost: 1,250 gp and 2 months to craft"), { slot: "hands", cost: 1250, magic: true });
  assert.deepEqual(adventureItemShape("When ingested, it soothes. Cost: 5 sp per dose"), { slot: null, cost: 0.5, magic: false });
  assert.deepEqual(adventureItemShape("A plain cup."), { slot: null, cost: null, magic: false });
});

console.log(`\n${n} adventure-item binding checks passed`);
