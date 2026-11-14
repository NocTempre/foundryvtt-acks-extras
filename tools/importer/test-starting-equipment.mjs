/**
 * `parseEquipment` — splitting a template's printed Starting Equipment cell.
 *
 * The cell is prose written by a human for humans, and every class's author
 * punctuated it their own way. What this pins is the SPLITTING: where one item
 * ends and the next begins, which separators count, and which do not. What each
 * piece then resolves to is the equipment menu's business and is stubbed here to
 * whatever the case under test needs.
 *
 * No book text is reproduced. The cells below are shaped like the printed ones —
 * same punctuation, invented gear.
 */
import assert from "node:assert";
import { parseEquipment, nameForms, liftBookSpells, liftCompanions, buildPaths, readTrainingCells, classRepertoireFor, templateOption } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const formsOf = (n) => nameForms(n).map((text) => ({ text, fold: fold(text) })).filter((f) => f.fold);
/** An equipment menu in the shape the real one is built in. */
const menu = (...names) =>
  names
    .map((name) => ({
      name,
      ref: `def.equip.${fold(name)}`,
      fold: fold(name),
      foldStripped: fold(name.replace(/\([^)]*\)/g, " ")),
      forms: formsOf(name),
      stripped: formsOf(name.replace(/\([^)]*\)/g, " ")),
    }))
    .sort((a, b) => b.name.length - a.name.length);

const names = (cell, m = menu()) => parseEquipment(cell, m).items.map((i) => i.name);

/* --- Semicolons separate, the same as commas ------------------------------- */
//
// Splitting on the comma alone fused whatever followed a semicolon onto the item
// before it, so a character started play holding a staff welded to a spell.
const grouped = names("lacquered spellbook with dim lantern and one spell of character's choice; worn walking staff, blue robe");
check("a semicolon ends an item", grouped.includes("worn walking staff"));
check("nothing is left welded across the semicolon", !grouped.some((n) => n.includes(";")));
check("the comma after it still separates", grouped.includes("blue robe"));

/* --- The leading "and" is stripped ----------------------------------------- */
//
// The strip runs AFTER the trim: before it, only the first chunk could match,
// and that is the one that never begins with "and". Every list's last item
// would otherwise carry the conjunction as part of its name.
const listed = names("a spear, a shield, and a helmet");
check("the last item of a list drops its 'and'", listed.includes("a helmet"));
check("no item is named with a leading 'and'", !listed.some((n) => /^and\b/i.test(n)));
check("'and' inside a name is untouched", names("bow and arrow set").includes("bow and arrow set"));

/* --- What the separators must NOT break ------------------------------------ */
check("a comma inside brackets holds the item together",
  names("ornamental crystal ball (etched, polished)").includes("ornamental crystal ball (etched, polished)"));
check("a semicolon inside brackets holds it together too",
  names("waxed tablet (ruled; gridded)").includes("waxed tablet (ruled; gridded)"));

/* --- Rules the split must keep obeying ------------------------------------- */
//
// A counted container splits into itself and its contents, and the count lands
// on the contents where the sheet can spend it.
const satchel = parseEquipment("satchel with 12 pebbles", menu()).items;
check("a counted container splits into device and load", satchel.length === 2 && satchel[0].name === "satchel");
check("the count rides the load, not the device", satchel[1].qty === 12 && satchel[0].qty === 1);
check("and the load records where it is carried", /carried in satchel/.test(satchel[1].note));
check("an uncounted container stays one item", names("pouch with herbs").length === 1);

/* --- A pair of known items splits, whatever they are called ---------------- */
//
// The whole-descriptor guard exists so a printed outfit of two garments (RR p25,
// JJ p449) — one printed outfit at one printed price — is not torn in half. It
// must not ask `resolve`, whose containment fallback answers yes for the wrong
// reason: a pair whose second name CONTAINS a known item's name reads as an
// already-known item and the pair never splits. The character would get one
// item named for two weapons, and the rule would only fire when both halves
// happened to fold shorter than six characters.
check("a pair of known weapons splits", names("spear and sword", menu("Spear", "Sword")).length === 2);
check("a long-named half no longer swallows the pair",
  names("spear and short sword", menu("Spear", "Short Sword")).length === 2);
check("and both halves come out under their own names",
  names("spear and short sword", menu("Spear", "Short Sword")).join("|") === "spear|short sword");
check("name length is irrelevant on either side",
  names("drover's harness and short sword", menu("Drover's Harness", "Short Sword")).length === 2);

// What the guard is FOR, and still does.
check("an outfit the menu knows whole stays whole", names("smock and breeches", menu("Smock and Breeches")).length === 1);
check("a bracketed qualifier does not stop it being known whole",
  names("smock and breeches", menu("Smock and Breeches (plain)")).length === 1);
check("an alias naming the whole thing keeps it whole",
  parseEquipment("long forked pike and haft", menu("Great Pike"), { "long forked pike and haft": "def.equip.greatpike" }).items.length === 1);

// Both halves must be known — one alone proves nothing about the other.
check("a pair the menu knows nothing about stays whole", names("odds and ends").length === 1);
check("one known half is not enough to split", names("spear and whatnot", menu("Spear")).length === 1);
check("splitting is not attempted on a phrase with no 'and'", names("short sword", menu("Short Sword")).length === 1);

// A DESCRIBED half is still a known half. Both of these read as pairs of bare
// catalogue names until the cell dresses one of them, and a printed cell always
// does (RR p39): a described pair of weapons must not come out as ONE weapon
// carrying the second's damage, which happens when the containment floor cannot
// see a base name of five letters and so declares the left half unknown.
check("an embellished half still splits the pair",
  names("polished sword and dagger", menu("Sword", "Dagger")).length === 2);
check("both descriptions survive the split",
  names("military-issue spear and sword", menu("Spear", "Sword")).join("|") === "military-issue spear|sword");

/* --- A short base name is findable, but only as a whole word --------------- */
//
// Six characters is where bare containment stops being a coincidence, and most
// of the printed weapons fold shorter than that. Left at six, "polished sword"
// pointed at nothing at all and was imported as a nameless trinket.
check("a five-letter base is found inside its description", names("polished sword", menu("Sword"))[0] === "polished sword");
check("and it is the SWORD that was found", parseEquipment("polished sword", menu("Sword")).items[0].ref === "def.equip.sword");
check("a plural cell names the singular item", parseEquipment("torches", menu("Torch")).items[0].ref === "def.equip.torch");
check("an -es plural too", parseEquipment("2 torches in a sack", menu("Torch")).items[0].ref === "def.equip.torch");
// What the whole-word rule is FOR: a short name buried mid-word is not a hit.
check("a short name inside a longer word is not a match", parseEquipment("grimace mask", menu("Mace")).items[0].ref === "");
check("nor is a three-letter name a match at all", parseEquipment("oiled leather satchel", menu("Oil")).items[0].ref === "");

/* --- Coin and encumbrance still come off cleanly --------------------------- */
const paid = parseEquipment("a dagger, 17gp, 6sp (Enc. 2 stones).", menu("Dagger"));
check("gold and silver are read out of the cell", paid.gp === 17 && paid.sp === 6);
check("the encumbrance note is lifted off the end", /2 stones/.test(paid.enc));
check("neither leaves an empty item behind", paid.items.length === 1 && paid.items[0].name === "a dagger");
// "(37gp value)" PRICES an item; it is not money the character is carrying.
const valued = parseEquipment("ribbon-tipped staff (37gp value)", menu());
check("a priced item adds no coin to the purse", valued.gp === 0);
check("and keeps its whole printed name", valued.items[0].name === "ribbon-tipped staff (37gp value)");

/* --- What the coin lift leaves behind is not an item ----------------------- */
// Taking "31gp of trade goods of any kind" out of its clause strands the
// words in front of it, and "a further" must not go on the sheet as gear.
const further = parseEquipment("a dagger, and a further 31gp of trade goods of any kind", menu("Dagger"));
check("a stranded connective is not an item", !further.items.some((i) => /^(a further|and|a|of)$/i.test(i.name.trim())));
check("and the gear beside it survives", further.items.length === 1 && /dagger/i.test(further.items[0].name));
check("while the coin is still read", further.gp === 31);
// The guard names function words, not one reported phrase, so it must never
// reach a descriptor that carries a noun — however short or common the noun.
check("a real item made of short words is kept", names("a war dog").length === 1);
check("an item whose name is mostly function words is kept", names("suit of plate").length === 1);

/* --- The catalogue's own naming conventions -------------------------------- */
//
// The price list writes a name head-first with its qualifier after a comma;
// a template's cell writes the same thing as English. Read only as printed,
// the two halves of one book could never meet — 250-odd descriptors matched
// nothing for this reason alone.
check("a comma-inverted name is found the way a cell writes it",
  parseEquipment("3 days’ hard biscuit", menu("Biscuit, Hard")).items[0].ref === "def.equip.biscuithard");
// The printed order stays a form of the name (a cell can never test it: the
// comma inside it is the splitter's own separator).
check("and the name as printed is still one of its forms",
  nameForms("Biscuit, Hard")[0] === "Biscuit, Hard" && nameForms("Biscuit, Hard").includes("Hard Biscuit"));
check("a three-segment name inverts whole",
  parseEquipment("festive harness and bells", menu("Harness and bells, Festive")).items[0].ref === "def.equip.harnessandbellsfestive");
check("a slash names one row by either word",
  parseEquipment("pail", menu("Pail/Bucket")).items[0].ref === "def.equip.pailbucket" &&
  parseEquipment("bucket", menu("Pail/Bucket")).items[0].ref === "def.equip.pailbucket");
check("a slash and a comma compose",
  nameForms("Cord/Tassel, Silk").includes("Silk Tassel"));
// The HEAD alone must not answer: the bare word is another row's own name.
check("the head of a qualified name is not a form of it",
  !nameForms("Mitts/Gloves, Wool, Long").includes("Mitts"));

/* --- A set the catalogue sells whole is not torn in half ------------------- */
//
// A satchel sold with its pebbles is one priced row; the cell words the
// same set with a connective. Split, the character would get two things the
// price list has never heard of, and the encumbrance would be counted twice.
const set = parseEquipment("satchel with 12 pebbles", menu("Satchel, 12 Pebbles"));
check("a catalogue set stays one item", set.items.length === 1);
check("and it points at the row that sells it", set.items[0].ref === "def.equip.satchel12pebbles");
check("a container the catalogue does NOT sell loaded still splits",
  parseEquipment("sack with 12 iron spikes", menu("Sack, Small")).items.length === 2);

/* --- A book's contents are an English list, written across the commas ------ */
const book = parseEquipment("Bark-bound prayer book with dim lantern, loud bang, and cold hearth, holy symbol", menu("Prayer Book", "Holy Symbol"));
check("a book's spell list is not split into gear", book.items.length === 2);
check("the book keeps its whole printed clause", /dim lantern, loud bang, and cold hearth/.test(book.items[0].name));
check("and the gear after the list is still its own item", book.items[1].name === "holy symbol");
// The list has to actually close with an "and", or nothing is absorbed.
check("a book followed by an ordinary list is left alone",
  parseEquipment("spellbook with sharpness, short bow, short sword", menu("Spell Book", "Short Bow", "Short Sword")).items.length === 3);

const lifted = [{ name: "Ancient prayer book with loud bang, cold hearth, and quiet step", note: "" }];
const spells = liftBookSpells(lifted);
check("the spells come out of the book's name", spells.map((s) => s.name).join("|") === "Loud bang|Cold hearth|Quiet step");
check("and the book is left named as a book", lifted[0].name === "Ancient prayer book");
check("with the printed sentence kept on its note", /holds loud bang, cold hearth, and quiet step/.test(lifted[0].note));
const choice = [{ name: "Lacquered spellbook with dim lantern and one spell of character’s choice", note: "" }];
const picked = liftBookSpells(choice);
check("a pick is never minted as a spell", picked.filter((s) => !s.offer).map((s) => s.name).join("|") === "Dim lantern");
// The clause is never dropped: the player is owed a spell, and something on
// the character has to say so.
check("the pick rides as an OFFER instead of vanishing", picked.filter((s) => s.offer).length === 1);
const offer = picked.find((s) => s.offer);
check("the offer names no spell and points at the class's list", offer.name === "" && offer.uuid === "" && offer.choice.from === "spellList" && offer.choice.count === 1);
check("the offer carries a stable key, so a re-import mints one marker", typeof offer.choice.key === "string" && offer.choice.key.length > 0);
check("the same book read twice yields the same key", liftBookSpells([{ ...choice[0], name: "Lacquered spellbook with dim lantern and one spell of character’s choice", note: "" }]).find((s) => s.offer).choice.key === offer.choice.key);
check("but the sentence offering it survives", /one spell of character’s choice/.test(choice[0].note));
check("a book with no pick offers nothing", liftBookSpells([{ name: "Plain spellbook with hush", note: "" }]).some((s) => s.offer) === false);
check("a counted load is not a library", liftBookSpells([{ name: "satchel with 12 pebbles", note: "" }]).length === 0);

/* --- What the page says this one is worth ---------------------------------- */
//
// Most of what carries a bracketed price has no catalogue row at all — the cell
// prices it precisely because the shop list does not — so this is the only
// value the item will ever have.
const worth = parseEquipment("gaudy silver rings (14gp value), ribbon-tipped staff (37gp value)", menu("Staff"));
check("a bracketed price is read onto the item", worth.items[0].cost === 14);
check("even when the item also has a base", worth.items[1].cost === 37 && worth.items[1].ref === "def.equip.staff");
check("and none of it reaches the purse", worth.gp === 0);
check("an unpriced item carries no cost at all", parseEquipment("a dagger", menu("Dagger")).items[0].cost === undefined);

/* --- A closing bracket can end a descriptor -------------------------------- */
//
// One cell prints its book and the quill after it with no comma between them.
const welded = parseEquipment("holy book (the book of lanterns) quill", menu("Holy Book", "Quill"));
check("a known item after a bracket is its own item", welded.items.length === 2);
check("and the bracket stays with the item it qualifies", welded.items[0].name === "holy book (the book of lanterns)");
// The guard: this must never fire on the brackets every other cell ends with.
check("a bracket that ends the descriptor is left alone",
  parseEquipment("holy symbol (grey heron)", menu("Holy Symbol")).items.length === 1);
check("nor does it fire when what follows is not gear",
  parseEquipment("ornamental crystal ball (14gp value) of dubious provenance", menu("Crystal Ball")).items.length === 1);

/* --- A stray comma inside one printed name -------------------------------- */
check("an outfit broken by a stray comma is put back",
  parseEquipment("moss green cloak, smock, and breeches", menu("Cloak", "Smock and Breeches")).items.length === 2);
check("while an ordinary list keeps its last item",
  parseEquipment("a spear, a shield, and a helmet", menu("Spear", "Shield", "Helmet")).items.length === 3);

/* --- A price in brackets is never coin ------------------------------------- */
//
// The lift eats to the next comma, so a bracketed amount taken as money cut the
// item's name off at the bracket AND inflated the purse.
const bare = parseEquipment("silver earrings (14gp), backpack", menu("Backpack"));
check("a bracketed price adds nothing to the purse", bare.gp === 0);
check("and the item keeps its name", bare.items[0].name === "silver earrings (14gp)");
check("coin outside brackets is still read", parseEquipment("a dagger, 17gp", menu("Dagger")).gp === 17);

/* --- A creature named in an equipment cell is not equipment ---------------- */
//
// A companion cell is the template answering a question the ABILITY leaves
// open: the companion slot is empty on purpose, because which creature it is
// is not a property of the ability. Read as gear it would be an item with no
// base, no mechanics and no creature behind it.
const COMPANIONS = { "banner beast": { ref: "def.power.bannerbeast" }, familiar: { ref: "def.prof.familiar" } };
const kit = [{ name: "Rat banner beast", ref: "" }, { name: "club", ref: "def.equip.club" }];
const profs = [];
check("a creature is lifted off the item list", liftCompanions(kit, profs, COMPANIONS) === 1 && kit.length === 1);
check("and the gear beside it is untouched", kit[0].name === "club");
check("it becomes the selection on the ability that confers it",
  profs.length === 1 && profs[0].ref === "def.power.bannerbeast" && profs[0].selection === "rat");

// The witch's proficiency column already prints "Familiar", so the cell naming
// her cat must fill THAT entry — not add a second one the class would grant
// again.
const witchKit = [{ name: "Black cat familiar", ref: "" }];
const witchProfs = [{ ref: "def.prof.familiar", name: "Familiar", rank: 1, selection: "" }];
liftCompanions(witchKit, witchProfs, COMPANIONS);
check("an ability the row already carries is filled, not duplicated",
  witchProfs.length === 1 && witchProfs[0].selection === "black cat");
// A selection the proficiency column already made is never overwritten.
const chosen = [{ ref: "def.prof.familiar", name: "Familiar", rank: 1, selection: "eagle" }];
liftCompanions([{ name: "Eagle familiar", ref: "" }], chosen, COMPANIONS);
check("a selection the column already made stands", chosen[0].selection === "eagle");
// Gear that merely mentions an animal is still gear.
const dog = [{ name: "trained hunting dog", ref: "def.equip.dogHunting" }];
check("gear is not lifted by an animal's name", liftCompanions(dog, [], COMPANIONS) === 0);

/* --- A class's PATH GROUPS --------------------------------------------------- */
//
// A spread whose training differs per variant prints a grid, not a sentence, so
// there is no paragraph to read. Each row becomes one option of a group, and a
// class's starting templates are a group of the same kind.
const GRID = [
  { label: "Region", key: "region", cells: { armour: "Armor Proficiencies", weapons: "Weapon Proficiencies", styles: "Fighting Style Proficiencies" } },
  { label: "Fenmark", key: "fenmark", cells: { armour: "Medium Light Very Light", weapons: "Mace, dagger, spear", styles: "Weapon and shield two-handed weapon" } },
  { label: "Tideholds", key: "tideholds", cells: { armour: "Light Very Light", weapons: "sling, short sword", styles: "dual weapon" } },
];
const groups = buildPaths(GRID, "Region", true);
check("the grid's own header line is not an option", groups[0].options.length === 2);
check("a variant group is built from the rows", groups[0].key === "region" && groups[0].options[0].label === "Fenmark");
check("a class's starting templates are a group too", groups[1].source === "templates" && groups[1].options.length === 0);
check("a class with no templates gets no templates group", buildPaths(GRID, "Region", false).length === 1);
check("a class with neither gets no groups at all", buildPaths([], "", false).length === 0);

// The armour column names every rung it permits, so the answer is the heaviest.
const north = readTrainingCells(GRID[1].cells);
check("the heaviest rung named is the answer", north.armour === "medium");
check("a lighter row is not dragged up by its neighbour", readTrainingCells(GRID[2].cells).armour === "light");
check("styles are read as the grant vocabulary", north.styles.join(",") === "twohanded,weaponshield");
check("weapons come through as names", north.weapons.includes("mace") && north.weapons.includes("spear"));
// PER-OPTION DATA STAYS ON THE OPTION. Every region here permits medium; the
// value is still written on each, so a custom path — or a printing that
// differs — has somewhere to say otherwise.
const same = buildPaths(
  [GRID[0], GRID[1], { ...GRID[1], label: "Elsewhere", key: "elsewhere" }],
  "Region",
  false,
);
check("a value every option shares is still written on each",
  same[0].options.every((o) => o.training.armour === "medium"));

// --- a title's own "and" (every title below is invented) ---
const known = (n) => ["mend pot and pan", "quiet step"].includes(String(n).toLowerCase());
const owned = () => [{ name: "Worn spellbook with mend pot and pan, and quiet step", note: "" }];
check("an 'and' inside a known title does not split it",
  liftBookSpells(owned(), { known }).map((s) => s.name).join("|") === "Mend pot and pan|Quiet step");
check("without a title index every conjunction splits, as before", liftBookSpells(owned()).length === 3);

// --- a class's printed repertoire off the executed pages: one grid per header
// row, the printed number as the row label, a name column per level ---
const grid = (levels, ...rows) => ({
  rows: rows.map((names, i) => ({
    key: String(i + 1),
    label: String(i + 1),
    cells: Object.fromEntries(names.map((name, j) => [`L${levels[j]}`, name]).filter(([, name]) => name)),
  })),
});
const pages = {
  fields: {
    gadabout: { divineL12: grid([1, 2], ["quiet step", "loud bang"], ["mend pot and pan", ""]) },
    wayfarer: { divineL123: grid([1, 2, 3]) },
  },
};
const rep = classRepertoireFor(pages, "Gadabout");
check("a class's repertoire is read off its nested grid, a column per level, in printed order",
  rep.length === 2 && rep[0].level === 1 && rep[0].tradition === "divine" && rep[0].names.join("|") === "quiet step|mend pot and pan" && rep[1].level === 2 && rep[1].names.join("|") === "loud bang");
check("a class the pages do not print has none", classRepertoireFor(pages, "Mudlark").length === 0);
check("an empty grid is no list", classRepertoireFor(pages, "Wayfarer").length === 0);
check("a flat dotted field reads the same",
  classRepertoireFor({ fields: { "mudlark.divineL456": grid([4, 5, 6], ["dim lantern", "", ""]) } }, "Mudlark")[0].level === 4);
check("no pages, no repertoire", classRepertoireFor(null, "Mudlark").length === 0);


// The template binder: a row's spell column is the generated creature's slot
// block, and the prose's cast-as word rides beside the row's caster level.
{
  const ax = { key: "age", keyIsHd: false, budgetCol: null };
  const opts = { id: "t.probe", cite: "", sectionText: new Map() };
  const cast = templateOption(ax, { key: "adult", label: "Adult" }, { hitDice: "8", spells: "2 1 - - -", casterLevel: "4th" }, { ...opts, spellSource: "mage" });
  check("a spell column becomes the option's slot block",
    cast.merge.spells?.enabled === true && cast.merge.spells[1]?.max === 2 && cast.merge.spells[2]?.max === 1 && cast.merge.spells[3]?.max === 0);
  check("the cast-as word and the caster level ride on the option's flags",
    cast.flags["acks-extras"]?.extras?.spellcasting?.class === "Mage" && cast.flags["acks-extras"].extras.spellcasting.level === 4);
  const mute = templateOption(ax, { key: "young", label: "Young" }, { hitDice: "4", spells: "- - - - -" }, { ...opts, spellSource: "mage" });
  check("a row printing no slots neither enables the block nor flags a caster", !mute.merge.spells?.enabled && !mute.flags["acks-extras"]?.extras?.spellcasting);
  const noWord = templateOption(ax, { key: "adult", label: "Adult" }, { hitDice: "8", spells: "1 - - - -" }, opts);
  check("slots without a cast-as word keep the block and flag nothing", noWord.merge.spells?.enabled === true && !noWord.flags["acks-extras"]?.extras?.spellcasting);
}
console.log(`test-starting-equipment: all ${pass} checks passed`);
