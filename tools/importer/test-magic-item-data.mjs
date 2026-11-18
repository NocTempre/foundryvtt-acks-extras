/**
 * A magic item's creation data (`magicItemData`, `cookbook/magic-items.mjs`):
 * the whitelist it reads from an executed page, the markets flag it writes
 * and the stamp it keeps beside it. The node is invented: no PDF, no Foundry.
 *
 * Usage: node tools/importer/test-magic-item-data.mjs
 */
import assert from "node:assert/strict";
import { CATEGORY_CORE_TYPE, MAGIC_CATEGORIES, coreTypeOf, magicItemData } from "../../scripts/importer/cookbook/magic-items.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const ID = "zz.item5";
const entry = { kind: "kind.magicItem", name: "Item 5", cite: "ZZ p. 1", meta: { category: "rings" } };
const node = (extra = {}) => ({
  ok: true,
  book: "zz",
  page: 1,
  fields: {
    name: { title: "Brenmoth Flask:" },
    description: [{ text: "A lantern that burns with a dim light." }],
    values: [{ field: "baseCostGp", amount: 1250 }, { field: "apparentValueGp", amount: 12.5 }],
    ...extra,
  },
});
const flagsOf = (data) => data.flags["acks-extras"];

t("the name is read from the page, and the row's label stands where the page gave none", () => {
  assert.equal(magicItemData("zz", ID, entry, node()).name, "Brenmoth Flask");
  assert.equal(magicItemData("zz", ID, entry, node({ name: { title: "" } })).name, "Item 5");
});

t("the markets flag holds magic and the located figures, a decimal one kept", () => {
  const data = magicItemData("zz", ID, entry, node());
  assert.deepEqual(flagsOf(data).markets, { magic: true, baseCostGp: 1250, apparentValueGp: 12.5 });
  assert.deepEqual(flagsOf(data).cookbook.read, { markets: { baseCostGp: 1250, apparentValueGp: 12.5 } });
});

t("a figure not read is absent, never 0, and an empty values list gives none", () => {
  const some = magicItemData("zz", ID, entry, node({ values: [{ field: "baseCostGp", amount: 90 }] }));
  assert.deepEqual(flagsOf(some).markets, { magic: true, baseCostGp: 90 });
  const none = magicItemData("zz", ID, entry, node({ values: undefined }));
  assert.deepEqual(flagsOf(none).markets, { magic: true });
  assert.equal(flagsOf(none).cookbook.read, undefined);
  assert.deepEqual(flagsOf(magicItemData("zz", ID, entry, node({ values: [] }))).markets, { magic: true });
});

t("a value that is not a figure of the kind, or not a number, is not read", () => {
  const data = magicItemData("zz", ID, entry, node({ values: [{ field: "other", amount: 5 }, { field: "baseCostGp", amount: NaN }] }));
  assert.deepEqual(flagsOf(data).markets, { magic: true });
});

t("scan output on the node changes nothing: the data is the same as without it", () => {
  const plain = magicItemData("zz", ID, entry, node());
  const scanned = magicItemData("zz", ID, entry, node({
    effects: [{ type: "bonus", value: 3 }],
    defenses: { immune: ["x"] },
    rolls: [{ key: "r", formula: "1d6" }],
    effectsFrom: "scan",
    derivedKey: 9,
  }));
  assert.deepEqual(scanned, plain);
});

t("the stamp names the id, book, kind, page reference and whether a reviewer audited the row", () => {
  const stamp = flagsOf(magicItemData("zz", ID, entry, node())).cookbook;
  assert.deepEqual({ id: stamp.id, book: stamp.book, kind: stamp.kind, cite: stamp.cite, unaudited: stamp.unaudited }, { id: ID, book: "zz", kind: "kind.magicItem", cite: "ZZ p. 1", unaudited: true });
  assert.equal(flagsOf(magicItemData("zz", ID, { ...entry, audited: "2026-11-17" }, node())).cookbook.unaudited, false);
});

t("the core type follows the category, and the vocabulary is the classic lists' keys", () => {
  assert.equal(magicItemData("zz", ID, { ...entry, meta: { category: "swords" } }, node()).type, "weapon");
  assert.equal(magicItemData("zz", ID, { ...entry, meta: { category: "weapons" } }, node()).type, "weapon");
  assert.equal(magicItemData("zz", ID, { ...entry, meta: { category: "armors" } }, node()).type, "armor");
  for (const c of ["potions", "rings", "scrolls", "implements", "misc"]) assert.equal(coreTypeOf(c), "item", c);
  assert.deepEqual(Object.keys(CATEGORY_CORE_TYPE).filter((c) => !MAGIC_CATEGORIES.includes(c)), [], "every mapped category is in the vocabulary");
  assert.equal(MAGIC_CATEGORIES.length, 8);
});

t("the folder rides a create and is absent from a repair's data", () => {
  assert.equal(magicItemData("zz", ID, entry, node(), "folder1").folder, "folder1");
  assert.equal(magicItemData("zz", ID, entry, node()).folder, null);
});

console.log(`\nmagic-item-data: ${n} checks OK`);
