/**
 * The Treasure Tome's table recipes for the `magicItemTables` document: the
 * Classic and Heroic or Gritty item-generation chains (TT folios 30 to 50) and
 * the scroll sub-tables its scroll entries print (folios 94 to 98). Geometry
 * and anchors only; every band edge, caption and name is read from the Judge's
 * own copy at import (docs/importer/RECIPES.md), and `magic-item-lists.mjs` says
 * which of these tables join into which list of the engine's document.
 *
 * Every table is optional: a seat without the Tome reads none of them, and the
 * Judges Journal's lists stand. A page is found by a phrase it prints, never by
 * a figure; a page that prints no heading is found by words every row of its
 * column carries (`bare`), the exact folio being searched first.
 *
 * The Tome sets its pages in two geometries, a verso at one left margin and a
 * recto 27 points to its right, and sets a category's subtables one under
 * another, or three across.
 */
import { list } from "../../table-recipes-magic-items.mjs";

/** The Tome's printed folio of each page a table is read from. */
const PAGE = Object.freeze({ weaponKinds: 51, classic: 30, heroic: 31, potionsA: 32, potionsB: 33, potionsC: 34, potionsD: 35, rings: 36, scrolls: 37, implementsB: 38, misc1: 39, misc2: 40, misc3: 41, misc4: 42, misc5: 43, misc6: 44, misc7: 45, swords1: 46, swords2: 47, weapons1: 48, weapons2: 49, armors1: 49, armors2: 50, languages: 94, spellLevels: 96, mapContents: 96, clues: 97, code: 98 });

/**
 * One Tome list. `bare` names the page by words with the spaces taken out (a
 * page with no heading of its own).
 */
const tt = ({ bare = false, ...spec }) => ({ ...list({ book: "tt", ...spec }), optional: true, ...(bare ? { locateBare: true } : {}) });

const LEFT = { xMin: 40, xMax: 300 };
const RIGHT = { xMin: 300, xMax: 592 };
const FULL = { xMin: 40, xMax: 592 };

/** A potion subtable's cells on a verso page and on a recto page: the name, then the physical cues. */
const POTION_VERSO = { labelMaxX: 82, cells: [["item", 83, 166], ["cues", 250, 330]] };
const POTION_RECTO = { labelMaxX: 109, cells: [["item", 110, 166], ["cues", 277, 310]] };
/** The potion subtables' page phrase: every row of every one prints it. */
const POTION_PAGE = { locate: "Potion of", bare: true };

/** Category lists on the Classic page: left column (potions and scrolls carry a tail, so their labels sit further in), right column. */
const CLASSIC = { page: PAGE.classic, locate: "Magic Item Tables (Classic)" };
const LEFT_TAIL = { labelMaxX: 104, cells: [["item", 105, 190]] };
const LEFT_PLAIN = { labelMaxX: 79, cells: [["item", 80, 215]] };
const RIGHT_COL = { labelMaxX: 340, cells: [["item", 341, 245]] };

/** Rarity lists on the Heroic page. */
const HEROIC = { page: PAGE.heroic, locate: "(Heroic or Gritty)" };
const HEROIC_RIGHT = { labelMaxX: 366, cells: [["item", 367, 220]] };

/** Ring subtables, three across on a verso page. */
const RINGS = { page: PAGE.rings, locate: "Ring Subtables" };
const RING_COL1 = { labelMaxX: 82, cells: [["item", 83, 118]] };
const RING_COL2 = { labelMaxX: 237, cells: [["item", 238, 136]] };
const RING_COL3 = { labelMaxX: 414, cells: [["item", 415, 175]] };

/** Scroll subtables, one under another in the left column of a recto page. */
const SCROLLS = { page: PAGE.scrolls, locate: "Scroll Subtables", column: { xMin: 40, xMax: 325 }, labelMaxX: 109, cells: [["item", 110, 212]] };

/**
 * Implement subtables: the first in the right column of the scroll page (under
 * its section heading), then five on the next page, a verso set three columns
 * across with a second table under the first in the left and middle columns.
 * Each prints its item name only.
 */
const IMPLEMENTS_A = { page: PAGE.scrolls, locate: "Implement Subtables", column: { xMin: 325, xMax: 592, yMin: 155, yMax: 560 }, labelMaxX: 366, cells: [["item", 367, 222]] };
const IMPLEMENTS_B = { page: PAGE.implementsB, locate: "Implement", bare: true };
const IMPLEMENT_COL1 = { labelMaxX: 82, cells: [["item", 83, 122]] };
const IMPLEMENT_COL2 = { labelMaxX: 248, cells: [["item", 249, 126]] };
const IMPLEMENT_COL3 = { labelMaxX: 417, cells: [["item", 418, 172]] };

/**
 * Miscellaneous item subtables, ten of them over seven pages. A verso page sets
 * its labels at one left margin and a recto page at another, 27 points on, and
 * the right column of each starts where its page puts it. A table too long for
 * one column runs on into the other column of its page as a `...More` segment
 * with no caption of its own.
 */
const MISC_PAGE = { locate: "Miscellaneous Item", bare: true };
/** The right column of the first miscellaneous page, under its section heading. */
const MISC_FIRST = { page: PAGE.misc1, locate: "Item Subtables", column: { xMin: 325, xMax: 592, yMin: 115, yMax: 500 }, labelMaxX: 366, cells: [["item", 367, 222]] };
const MISC_VERSO_L = { column: { xMin: 40, xMax: 298 }, labelMaxX: 82, cells: [["item", 83, 212]] };
const MISC_VERSO_R = { column: { xMin: 298, xMax: 592 }, labelMaxX: 328, cells: [["item", 330, 260]] };
const MISC_RECTO_L = { column: { xMin: 40, xMax: 325 }, labelMaxX: 110, cells: [["item", 111, 212]] };
const MISC_RECTO_R = { column: { xMin: 325, xMax: 592 }, labelMaxX: 357, cells: [["item", 358, 232]] };
/** One column of a miscellaneous page between two heights; `side` is one of the four column specs above. */
const miscCol = (page, side, yMin, yMax) => ({ page, ...MISC_PAGE, ...side, column: { ...side.column, yMin, yMax } });

/**
 * Sword, miscellaneous weapon and armour subtables: one per rarity, each a
 * caption over a d100 grid in one column of its page. Every list is sized to
 * its own content, so its label edge and item column are its own. A rarity
 * list too long for one column runs on into the other as a `...More` segment
 * with no caption of its own.
 */
const ARMS_VERSO_L = { column: { xMin: 40, xMax: 300 }, labelMaxX: 83, cells: [["item", 84, 216]] };
const ARMS_VERSO_R = { column: { xMin: 300, xMax: 592 }, labelMaxX: 340, cells: [["item", 341, 251]] };
const ARMS_RECTO_L = { column: { xMin: 40, xMax: 325 }, labelMaxX: 108, cells: [["item", 109, 216]] };
const ARMS_RECTO_R = { column: { xMin: 325, xMax: 592 }, labelMaxX: 366, cells: [["item", 367, 225]] };
/** One column of an arms page between two heights, found by the phrase `locate`. */
const armsCol = (page, locate, side, yMin, yMax, own = {}) => ({ page, locate, ...side, ...own, column: { ...(own.column ?? side.column), yMin, yMax } });

/** A list whose item names are read with their first letter raised, for a row the page sets in one lower-case run. */
const capitalFirst = (recipe) => ({ ...recipe, cellColumns: recipe.cellColumns.map((c) => ({ ...c, pattern: "rawCapital" })) });

/** Top-aligned wrapped lines: a continuation line belongs to the row above it. */
const topWrap = (recipe) => ({ ...recipe, wrapRows: { tol: 12, floorKey: "b0" } });

/**
 * A list whose header row opens on its die, with the caption set in the cell
 * zone beside it: the caption is the whole label run from the die on.
 */
const dieCaption = (recipe) => ({ ...recipe, rows: [{ key: "caption", labelRe: "^d\\d+", labelPattern: "labelText" }, ...recipe.rows.slice(1)] });

/**
 * The spell-level grid's six side-by-side lists: a band and the level it gives,
 * under the "1d100" header line, whose row also carries the column's
 * remaining-levels figure (read as the caption row's `level`).
 */
const spellLevel = ({ xMin, xMax, labelMaxX }) => {
  const base = tt({ page: PAGE.spellLevels, locate: "Spell Level by Total", column: { xMin, xMax, yMin: 104, yMax: 192 }, labelMaxX, cells: [["level", labelMaxX + 1, 40]], caption: true });
  return { ...base, wrapRows: undefined, rowTol: 5, rows: [{ key: "caption", labelRe: "^\\d*d\\d+$", labelPattern: "labelText" }, ...base.rows.slice(1)] };
};

/**
 * The Treasure Tome's own raw tables by ruledata document id, each optional and
 * read only where the Tome is open. `books/merge.mjs` joins them after the
 * shared recipes; `books/tt/magic-item-lists.mjs` says which engine list each
 * assembles into.
 */
export const tableRecipes = {
  magicItemTables: {
    pages: "TT 30-51, 94-98",
    tables: {
      // Random Magic Item Type, and the eight category lists, which name subtables.
      tomeTypeRaw: tt({ ...CLASSIC, column: { ...LEFT, yMin: 135, yMax: 258 }, labelMaxX: 82, cells: [["item", 83, 200]], caption: true }),
      tomePotionsRaw: tt({ ...CLASSIC, column: { ...LEFT, yMin: 258, yMax: 405 }, ...LEFT_TAIL, caption: true }),
      tomeRingsRaw: tt({ ...CLASSIC, column: { ...LEFT, yMin: 405, yMax: 495 }, ...LEFT_PLAIN, caption: true }),
      tomeScrollsRaw: tt({ ...CLASSIC, column: { ...LEFT, yMin: 495, yMax: 605 }, ...LEFT_TAIL, caption: true }),
      tomeImplementsRaw: tt({ ...CLASSIC, column: { ...RIGHT, yMin: 136, yMax: 236 }, ...RIGHT_COL, caption: true }),
      tomeMiscRaw: tt({ ...CLASSIC, column: { ...RIGHT, yMin: 237, yMax: 383 }, ...RIGHT_COL, caption: true }),
      tomeSwordsRaw: tt({ ...CLASSIC, column: { ...RIGHT, yMin: 383, yMax: 464 }, ...RIGHT_COL, caption: true }),
      tomeWeaponsRaw: tt({ ...CLASSIC, column: { ...RIGHT, yMin: 464, yMax: 542 }, ...RIGHT_COL, caption: true }),
      tomeArmorsRaw: tt({ ...CLASSIC, column: { ...RIGHT, yMin: 542, yMax: 640 }, ...RIGHT_COL, caption: true }),
      // The five rarity lists.
      tomeHeroicCommonRaw: tt({ ...HEROIC, column: { ...LEFT, yMin: 116, yMax: 215 }, labelMaxX: 110, cells: [["item", 111, 190]], caption: true }),
      tomeHeroicUncommonRaw: tt({ ...HEROIC, column: { ...RIGHT, xMin: 325, yMin: 70, yMax: 207 }, ...HEROIC_RIGHT, caption: true }),
      tomeHeroicRareRaw: tt({ ...HEROIC, column: { ...RIGHT, xMin: 325, yMin: 207, yMax: 387 }, ...HEROIC_RIGHT, caption: true }),
      tomeHeroicVeryRareRaw: tt({ ...HEROIC, column: { ...RIGHT, xMin: 325, yMin: 387, yMax: 545 }, ...HEROIC_RIGHT, caption: true }),
      tomeHeroicLegendaryRaw: tt({ ...HEROIC, column: { ...RIGHT, xMin: 325, yMin: 545, yMax: 660 }, ...HEROIC_RIGHT, caption: true }),

      // Potion subtables: three then three then one, one under another, the fourth running onto the next page.
      tomePotions1Raw: tt({ page: PAGE.potionsA, ...POTION_PAGE, column: { ...FULL, yMin: 134, yMax: 328 }, ...POTION_VERSO, caption: true }),
      tomePotions2Raw: tt({ page: PAGE.potionsA, ...POTION_PAGE, column: { ...FULL, yMin: 330, yMax: 600 }, ...POTION_VERSO, caption: true }),
      tomePotions3Raw: tt({ page: PAGE.potionsB, ...POTION_PAGE, column: { ...FULL, yMin: 70, yMax: 425 }, ...POTION_RECTO, caption: true }),
      tomePotions4Raw: tt({ page: PAGE.potionsB, ...POTION_PAGE, column: { ...FULL, yMin: 426, yMax: 745 }, ...POTION_RECTO, caption: true }),
      tomePotions4MoreRaw: tt({ page: PAGE.potionsC, ...POTION_PAGE, column: { ...FULL, yMin: 75, yMax: 240 }, ...POTION_VERSO }),
      tomePotions5Raw: tt({ page: PAGE.potionsC, ...POTION_PAGE, column: { ...FULL, yMin: 242, yMax: 728 }, ...POTION_VERSO, caption: true }),
      tomePotions6Raw: tt({ page: PAGE.potionsD, ...POTION_PAGE, column: { ...FULL, yMin: 205, yMax: 662 }, ...POTION_RECTO, caption: true }),
      tomePotions7Raw: tt({ page: PAGE.potionsD, ...POTION_PAGE, column: { ...FULL, yMin: 662, yMax: 748 }, ...POTION_RECTO, caption: true }),

      // Ring subtables: three across, then three across again, the fourth running into the middle column.
      tomeRings1Raw: tt({ ...RINGS, column: { xMin: 40, xMax: 198, yMin: 95, yMax: 400 }, ...RING_COL1, caption: true }),
      tomeRings2Raw: capitalFirst(tt({ ...RINGS, column: { xMin: 198, xMax: 376, yMin: 95, yMax: 400 }, ...RING_COL2, caption: true })),
      tomeRings3Raw: tt({ ...RINGS, column: { xMin: 376, xMax: 592, yMin: 95, yMax: 400 }, ...RING_COL3, caption: true }),
      tomeRings4Raw: tt({ ...RINGS, column: { xMin: 40, xMax: 198, yMin: 404, yMax: 748 }, ...RING_COL1, caption: true }),
      tomeRings4MoreRaw: tt({ ...RINGS, column: { xMin: 205, xMax: 376, yMin: 422, yMax: 748 }, labelMaxX: 242, cells: [["item", 243, 131]] }),
      tomeRings5Raw: tt({ ...RINGS, column: { xMin: 376, xMax: 592, yMin: 404, yMax: 575 }, ...RING_COL3, caption: true }),

      // Scroll subtables: five, one under another.
      tomeScrolls1Raw: tt({ ...SCROLLS, column: { ...SCROLLS.column, yMin: 95, yMax: 176 }, caption: true }),
      tomeScrolls2Raw: tt({ ...SCROLLS, column: { ...SCROLLS.column, yMin: 176, yMax: 371 }, caption: true }),
      tomeScrolls3Raw: tt({ ...SCROLLS, column: { ...SCROLLS.column, yMin: 371, yMax: 536 }, caption: true }),
      tomeScrolls4Raw: tt({ ...SCROLLS, column: { ...SCROLLS.column, yMin: 536, yMax: 644 }, caption: true }),
      tomeScrolls5Raw: tt({ ...SCROLLS, column: { ...SCROLLS.column, yMin: 644, yMax: 748 }, caption: true }),

      // Implement subtables: the first beside the scroll subtables, then five on a verso page, two of them under another.
      tomeImplements1Raw: tt({ ...IMPLEMENTS_A, caption: true }),
      tomeImplements2Raw: tt({ ...IMPLEMENTS_B, column: { xMin: 40, xMax: 205, yMin: 70, yMax: 330 }, ...IMPLEMENT_COL1, caption: true }),
      tomeImplements3Raw: tt({ ...IMPLEMENTS_B, column: { xMin: 40, xMax: 205, yMin: 331, yMax: 750 }, ...IMPLEMENT_COL1, caption: true }),
      tomeImplements4Raw: tt({ ...IMPLEMENTS_B, column: { xMin: 205, xMax: 375, yMin: 70, yMax: 556 }, ...IMPLEMENT_COL2, caption: true }),
      tomeImplements5Raw: tt({ ...IMPLEMENTS_B, column: { xMin: 205, xMax: 375, yMin: 557, yMax: 750 }, ...IMPLEMENT_COL2, caption: true }),
      tomeImplements6Raw: tt({ ...IMPLEMENTS_B, column: { xMin: 375, xMax: 592, yMin: 70, yMax: 750 }, ...IMPLEMENT_COL3, caption: true }),

      // Miscellaneous item subtables: one, two running across both columns, then a pair of columns each, in page order.
      tomeMisc1Raw: tt({ ...MISC_FIRST, caption: true }),
      tomeMisc2Raw: tt({ ...miscCol(PAGE.misc2, MISC_VERSO_L, 76, 497), caption: true }),
      tomeMisc2MoreRaw: tt(miscCol(PAGE.misc2, MISC_VERSO_R, 92, 497)),
      tomeMisc3Raw: tt({ ...miscCol(PAGE.misc2, MISC_VERSO_L, 498, 750), caption: true }),
      tomeMisc3MoreRaw: tt(miscCol(PAGE.misc2, MISC_VERSO_R, 498, 750)),
      tomeMisc4Raw: tt({ ...miscCol(PAGE.misc3, MISC_RECTO_L, 76, 305), caption: true }),
      tomeMisc4MoreRaw: tt(miscCol(PAGE.misc3, MISC_RECTO_R, 92, 305)),
      tomeMisc5Raw: tt({ ...miscCol(PAGE.misc3, MISC_RECTO_L, 306, 600), caption: true }),
      tomeMisc5MoreRaw: tt(miscCol(PAGE.misc3, MISC_RECTO_R, 306, 600)),
      tomeMisc6Raw: tt({ ...miscCol(PAGE.misc4, { ...MISC_VERSO_L, labelMaxX: 84, cells: [["item", 85, 210]] }, 76, 430), caption: true }),
      tomeMisc7Raw: tt({ ...miscCol(PAGE.misc4, { column: { xMin: 300, xMax: 592 }, labelMaxX: 339, cells: [["item", 340, 250]] }, 76, 575), caption: true }),
      tomeMisc8Raw: tt({ ...miscCol(PAGE.misc5, MISC_RECTO_L, 216, 750), caption: true }),
      tomeMisc8MoreRaw: tt(miscCol(PAGE.misc5, MISC_RECTO_R, 232, 750)),
      tomeMisc9Raw: tt({ ...miscCol(PAGE.misc6, MISC_VERSO_L, 216, 750), caption: true }),
      tomeMisc9MoreRaw: tt(miscCol(PAGE.misc6, MISC_VERSO_R, 232, 750)),
      tomeMisc10Raw: tt({ ...miscCol(PAGE.misc7, MISC_RECTO_L, 76, 460), caption: true }),
      tomeMisc10MoreRaw: tt(miscCol(PAGE.misc7, MISC_RECTO_R, 92, 460)),

      // The weapon-kind list: a die over the kinds of weapon a generic weapon row can stand for, beside the arms-and-armour prose.
      tomeWeaponKindRaw: dieCaption(tt({ page: PAGE.weaponKinds, locate: "Miscellaneous Weapon", column: { xMin: 329, xMax: 592, yMin: 385, yMax: 475 }, labelMaxX: 460, cells: [["item", 461, 100]], caption: true })),

      // Sword subtables: four rarities, the second and third running across both columns of their page.
      tomeSwords1Raw: tt({ ...armsCol(PAGE.swords1, "Uncommon Swords", ARMS_VERSO_L, 118, 245), caption: true }),
      tomeSwords2Raw: tt({ ...armsCol(PAGE.swords1, "Rare Swords", ARMS_VERSO_L, 246, 610, { labelMaxX: 96, cells: [["item", 97, 203]] }), caption: true }),
      tomeSwords2MoreRaw: tt(armsCol(PAGE.swords1, "Rare Swords", ARMS_VERSO_R, 270, 610)),
      tomeSwords3Raw: tt({ ...armsCol(PAGE.swords2, "Very Rare Swords", ARMS_RECTO_L, 288, 548, { column: { xMin: 40, xMax: 330 }, labelMaxX: 124, cells: [["item", 125, 205]] }), caption: true }),
      tomeSwords3MoreRaw: tt(armsCol(PAGE.swords2, "Very Rare Swords", ARMS_RECTO_R, 312, 548, { column: { xMin: 330, xMax: 592 }, labelMaxX: 365, cells: [["item", 366, 226]] })),
      tomeSwords4Raw: tt({ ...armsCol(PAGE.swords2, "Very Rare Swords", ARMS_RECTO_L, 553, 712, { column: { xMin: 40, xMax: 300 }, cells: [["item", 109, 190]] }), caption: true }),

      // Miscellaneous weapon subtables: the first beside the second on a verso page, the last two one under another on the next.
      tomeWeapons1Raw: tt({ ...armsCol(PAGE.weapons1, "Uncommon Miscellaneous Weapons", ARMS_VERSO_L, 138, 425, { labelMaxX: 82, cells: [["item", 83, 217]] }), caption: true }),
      tomeWeapons2Raw: tt({ ...armsCol(PAGE.weapons1, "Uncommon Miscellaneous Weapons", ARMS_VERSO_R, 75, 530, { labelMaxX: 338, cells: [["item", 339, 253]] }), caption: true }),
      tomeWeapons3Raw: tt({ ...armsCol(PAGE.weapons2, "Very Rare Miscellaneous Weapons", ARMS_RECTO_L, 78, 540), caption: true }),
      tomeWeapons4Raw: tt({ ...armsCol(PAGE.weapons2, "Very Rare Miscellaneous Weapons", ARMS_RECTO_L, 541, 745), caption: true }),

      // Armour subtables: two in the right column of a recto page, then a pair of columns on the next page.
      tomeArmors1Raw: tt({ ...armsCol(PAGE.armors1, "Armor Tables", ARMS_RECTO_R, 128, 245), caption: true }),
      tomeArmors2Raw: tt({ ...armsCol(PAGE.armors1, "Armor Tables", ARMS_RECTO_R, 248, 715), caption: true }),
      tomeArmors3Raw: tt({ ...armsCol(PAGE.armors2, "Very Rare Armor", ARMS_VERSO_L, 238, 735), caption: true }),
      tomeArmors4Raw: tt({ ...armsCol(PAGE.armors2, "Very Rare Armor", ARMS_VERSO_R, 75, 280), caption: true }),

      // The sub-tables the scroll entries print.
      tomeScrollLanguagesRaw: tt({ page: PAGE.languages, locate: "Scroll Languages", column: { ...LEFT, yMin: 262, yMax: 400 }, labelMaxX: 82, cells: [["item", 83, 215]], caption: true }),
      ...Object.fromEntries(
        [[40, 130, 95], [130, 213, 178], [213, 297, 260], [297, 380, 342], [380, 461, 424], [461, 592, 507]].map(([xMin, xMax, labelMaxX], i) => [`tomeSpellLevel${i + 1}Raw`, spellLevel({ xMin, xMax, labelMaxX })]),
      ),
      tomeMapContentsRaw: topWrap(tt(({ page: PAGE.mapContents, locate: "Treasure Map Contents", column: { ...RIGHT, yMin: 612, yMax: 735 }, labelMaxX: 360, cells: [["place", 368, 112], ["clues", 483, 60]], caption: true }))),
      tomeClueSpecificsRaw: topWrap(tt(({ page: PAGE.clues, locate: "Clue Specifics", column: { xMin: 60, xMax: 592, yMin: 80, yMax: 192 }, labelMaxX: 130, cells: [["detail", 135, 135], ["content", 271, 224], ["obscurity", 496, 94]], caption: true }))),
      tomeClueConcealmentRaw: topWrap(tt(({ page: PAGE.clues, locate: "Clue Concealment", column: { xMin: 60, xMax: 592, yMin: 358, yMax: 750 }, labelMaxX: 98, cells: [["type", 99, 86], ["text", 186, 404]], caption: true }))),
      tomeClueCodeRaw: topWrap(tt(({ page: PAGE.code, locate: "Clue Code", column: { xMin: 40, xMax: 592, yMin: 80, yMax: 470 }, labelMaxX: 71, cells: [["type", 72, 112], ["text", 183, 405]], caption: true }))),
    },
  },
};
