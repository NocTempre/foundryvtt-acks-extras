/**
 * The Treasure Tome's list map for the `magicItemTables` document: which of its
 * raw tables (`table-recipes.mjs`) join into which list id of the engine's
 * tables, which of those lists have rows that name other lists, and the hashed
 * spellings a list is also named by. `magic-item-binding.mjs` places each list
 * the Tome prints in the stead of the Judges Journal's list under the same id,
 * once its rows' hops resolve (the binding's docstring has the rule).
 *
 * Nothing here is printed content: a raw key is the module's name for a region,
 * and a subtable's id is a neutral ordinal in page order within its category
 * (`potions1`, `potions2`, ...), which the page's own numbering, restarting per
 * rarity, does not give. A card shows the caption as the page printed it.
 */

/**
 * `{<engine table>: {hops?, whole?, lists: {<column>: [raw keys in page order]}}}`.
 * `hops` names the table a list's rows name lists of; `whole` marks a printed
 * grid of side-by-side lists that replaces its table whole or not at all.
 */
export const MAGIC_ITEM_LISTS = Object.freeze({
  classicType: { hops: "classic", lists: { bands: ["tomeTypeRaw"] } },
  classic: {
    hops: "subtables",
    lists: {
      potions: ["tomePotionsRaw"],
      rings: ["tomeRingsRaw"],
      scrolls: ["tomeScrollsRaw"],
      implements: ["tomeImplementsRaw"],
      misc: ["tomeMiscRaw"],
      swords: ["tomeSwordsRaw"],
      armors: ["tomeArmorsRaw"],
      weapons: ["tomeWeaponsRaw"],
    },
  },
  heroic: {
    hops: "subtables",
    lists: {
      common: ["tomeHeroicCommonRaw"],
      uncommon: ["tomeHeroicUncommonRaw"],
      rare: ["tomeHeroicRareRaw"],
      veryRare: ["tomeHeroicVeryRareRaw"],
      legendary: ["tomeHeroicLegendaryRaw"],
    },
  },
  subtables: {
    lists: {
      potions1: ["tomePotions1Raw"],
      potions2: ["tomePotions2Raw"],
      potions3: ["tomePotions3Raw"],
      potions4: ["tomePotions4Raw", "tomePotions4MoreRaw"],
      potions5: ["tomePotions5Raw"],
      potions6: ["tomePotions6Raw"],
      potions7: ["tomePotions7Raw"],
      rings1: ["tomeRings1Raw"],
      rings2: ["tomeRings2Raw"],
      rings3: ["tomeRings3Raw"],
      rings4: ["tomeRings4Raw", "tomeRings4MoreRaw"],
      rings5: ["tomeRings5Raw"],
      scrolls1: ["tomeScrolls1Raw"],
      scrolls2: ["tomeScrolls2Raw"],
      scrolls3: ["tomeScrolls3Raw"],
      scrolls4: ["tomeScrolls4Raw"],
      scrolls5: ["tomeScrolls5Raw"],
    },
  },
  scrollLanguages: { lists: { bands: ["tomeScrollLanguagesRaw"] } },
  scrollSpellLevels: { whole: true, lists: Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`col${n}`, [`tomeSpellLevel${n}Raw`]])) },
  treasureMaps: {
    lists: {
      contents: ["tomeMapContentsRaw"],
      clueSpecifics: ["tomeClueSpecificsRaw"],
      clueConcealment: ["tomeClueConcealmentRaw"],
      clueCode: ["tomeClueCodeRaw"],
    },
  },
});

/**
 * The folded spellings (`printKey`, a hash) a list id is also named by where a
 * row's words differ from the list's caption by an inflection. Keyed by the id
 * the row names, so it applies whichever book's list stands there.
 */
export const ALSO_KEYS = Object.freeze({
  // The Random Type row for the armour list, which the page sets in the singular.
  "classic.armors": ["1ww2klw"],
});
